"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
let lastCommandState = { output: '', exitCode: null };
function setCORS(res, origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}
function sendJSON(res, code, data, origin) {
    setCORS(res, origin);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(code);
    res.end(JSON.stringify(data));
}
function getBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
    });
}
function pickEditor(filename) {
    const active = vscode.window.activeTextEditor;
    if (active)
        return active;
    if (filename && filename.length > 0) {
        return vscode.window.visibleTextEditors.find((e) => e.document.fileName.endsWith(filename));
    }
    return undefined;
}
function parsePosition(raw) {
    if (raw === 'end')
        return { kind: 'end' };
    if (raw === 'start')
        return { kind: 'start' };
    const m = raw.match(/^after:(.+)$/);
    if (m)
        return { kind: 'afterFunction', name: m[1] };
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0)
        return { kind: 'line', line: n };
    return { kind: 'end' };
}
function escRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchingBrace(text, open) {
    let depth = 1;
    let i = open + 1;
    while (i < text.length && depth > 0) {
        if (text[i] === '{')
            depth++;
        else if (text[i] === '}')
            depth--;
        i++;
    }
    return depth === 0 ? i - 1 : -1;
}
function locateFunctionEnd(text, name) {
    const patterns = [
        new RegExp(`function\\s+${escRegex(name)}\\s*\\(`, 'g'),
        new RegExp(`${escRegex(name)}\\s*=\\s*function\\s*\\(`, 'g'),
        new RegExp(`${escRegex(name)}\\s*=\\s*\\(?[^)]*\\)?\\s*(?:=>|{)`, 'g'),
        new RegExp(`${escRegex(name)}\\s*\\([^)]*\\)\\s*{`, 'g'),
        new RegExp(`def\\s+${escRegex(name)}\\s*\\(`, 'g'),
        new RegExp(`func\\s+${escRegex(name)}\\s*\\(`, 'g'),
        new RegExp(`fn\\s+${escRegex(name)}\\s*\\(`, 'g'),
    ];
    for (const p of patterns) {
        let match;
        while ((match = p.exec(text)) !== null) {
            const brace = text.indexOf('{', match.index);
            if (brace === -1)
                continue;
            const end = matchingBrace(text, brace);
            if (end !== -1)
                return end;
        }
    }
    return -1;
}
// ── /insert ─────────────────────────────────────────────────────
async function handleInsert(body, origin, res) {
    const code = body.code;
    const filename = body.filename;
    const position = body.position;
    if (typeof code !== 'string') {
        sendJSON(res, 400, { error: 'Missing "code" field' }, origin);
        return;
    }
    const editor = pickEditor(typeof filename === 'string' ? filename : undefined);
    if (!editor) {
        sendJSON(res, 400, { error: 'No active editor' }, origin);
        return;
    }
    const doc = editor.document;
    const text = doc.getText();
    const pos = parsePosition(typeof position === 'string' ? position : 'end');
    let insertAt;
    switch (pos.kind) {
        case 'start':
            insertAt = doc.positionAt(0);
            break;
        case 'end':
            insertAt = doc.positionAt(text.length);
            break;
        case 'line': {
            const line = Math.max(1, pos.line);
            const idx = Math.min(line - 1, doc.lineCount - 1);
            insertAt = doc.lineAt(idx).range.start;
            break;
        }
        case 'afterFunction': {
            if (!pos.name) {
                sendJSON(res, 400, { error: 'Missing function name in "after:"' }, origin);
                return;
            }
            const fnEnd = locateFunctionEnd(text, pos.name);
            if (fnEnd === -1) {
                sendJSON(res, 404, { error: `Function "${pos.name}" not found` }, origin);
                return;
            }
            insertAt = doc.positionAt(fnEnd + 1);
            break;
        }
        default:
            insertAt = doc.positionAt(text.length);
    }
    const suffix = pos.kind === 'afterFunction' ? '\n' : '';
    await editor.edit((eb) => {
        eb.insert(insertAt, code + suffix);
    });
    await editor.document.save();
    vscode.window.showInformationMessage('Code injected by FOUNDRY');
    sendJSON(res, 200, { status: 'ok' }, origin);
}
// ── /command ────────────────────────────────────────────────────
function runCapturedCommand(command, timeoutMs) {
    return new Promise((resolve) => {
        const child = (0, child_process_1.exec)(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            const combined = (stdout + '\n' + stderr).replace(/\n$/, '');
            if (error) {
                const code = typeof error.code === 'number' ? error.code : 1;
                resolve({ output: combined || error.message, exitCode: code });
            }
            else {
                resolve({ output: combined, exitCode: 0 });
            }
        });
    });
}
async function handleCommand(body, origin, res) {
    const cmd = body.command;
    if (typeof cmd !== 'string' || cmd.length === 0) {
        sendJSON(res, 400, { error: 'Missing "command" field' }, origin);
        return;
    }
    const capture = body.capture === true;
    if (capture) {
        try {
            const result = await runCapturedCommand(cmd, 30000);
            lastCommandState = { output: result.output, exitCode: result.exitCode };
            sendJSON(res, 200, { status: 'ok', output: result.output, exitCode: result.exitCode }, origin);
        }
        catch {
            lastCommandState = { output: 'Internal error', exitCode: -1 };
            sendJSON(res, 500, { error: 'Command execution failed' }, origin);
        }
    }
    else {
        let terminal;
        const existing = vscode.window.terminals;
        if (existing.length > 0) {
            terminal = existing[0];
        }
        else {
            terminal = vscode.window.createTerminal('FOUNDRY');
        }
        terminal.show();
        terminal.sendText(cmd, true);
        vscode.window.showInformationMessage('FOUNDRY: Running command');
        sendJSON(res, 200, { status: 'ok', command: cmd }, origin);
    }
}
// ── /open ────────────────────────────────────────────────────────
async function handleOpen(body, origin, res) {
    const filename = body.filename;
    if (typeof filename !== 'string' || filename.length === 0) {
        sendJSON(res, 400, { error: 'Missing "filename" field' }, origin);
        return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        sendJSON(res, 400, { error: 'No workspace folder open' }, origin);
        return;
    }
    const exact = await vscode.workspace.findFiles(`**/${filename}`, '**/node_modules/**', 10);
    if (exact.length === 0) {
        const base = path.basename(filename);
        const fallback = await vscode.workspace.findFiles(`**/${base}`, '**/node_modules/**', 10);
        if (fallback.length === 0) {
            sendJSON(res, 404, { error: `File "${filename}" not found in workspace` }, origin);
            return;
        }
        const doc = await vscode.workspace.openTextDocument(fallback[0]);
        await vscode.window.showTextDocument(doc);
        sendJSON(res, 200, { status: 'ok', file: fallback[0].fsPath }, origin);
        return;
    }
    const doc = await vscode.workspace.openTextDocument(exact[0]);
    await vscode.window.showTextDocument(doc);
    sendJSON(res, 200, { status: 'ok', file: exact[0].fsPath }, origin);
}
// ── /status ──────────────────────────────────────────────────────
function handleStatus(res, origin) {
    const editor = vscode.window.activeTextEditor;
    const activeFile = editor ? editor.document.fileName : '';
    const folders = vscode.workspace.workspaceFolders;
    const workspaceFolder = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
    sendJSON(res, 200, {
        status: 'ok',
        activeFile,
        workspaceFolder,
        lastCommandOutput: lastCommandState.output,
        lastCommandExitCode: lastCommandState.exitCode,
    }, origin);
}
// ── /file ────────────────────────────────────────────────────────
function handleFile(req, res, origin) {
    if (req.method !== 'GET') {
        setCORS(res, origin);
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    const parsedUrl = new URL(req.url, 'http://localhost');
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) {
        sendJSON(res, 400, { error: 'Missing "path" query param' }, origin);
        return;
    }
    if (!path.isAbsolute(filePath)) {
        sendJSON(res, 400, { error: 'Path must be absolute' }, origin);
        return;
    }
    if (filePath.indexOf('..') !== -1) {
        sendJSON(res, 403, { error: 'Path traversal denied' }, origin);
        return;
    }
    if (!fs.existsSync(filePath)) {
        sendJSON(res, 404, { error: 'File not found' }, origin);
        return;
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        sendJSON(res, 200, { status: 'ok', content, path: filePath }, origin);
    }
    catch {
        sendJSON(res, 404, { error: 'File not found or unreadable' }, origin);
    }
}
// ── Server ──────────────────────────────────────────────────────
function activate(context) {
    const server = http.createServer(async (req, res) => {
        const origin = req.headers.origin ?? '*';
        const url = req.url;
        // CORS preflight for any URL
        if (req.method === 'OPTIONS') {
            setCORS(res, origin);
            res.writeHead(204);
            res.end();
            return;
        }
        // /status accepts any method
        if (url === '/status') {
            handleStatus(res, origin);
            return;
        }
        // /file accepts GET (with query param ?path=...)
        if (url && (url === '/file' || url.startsWith('/file?'))) {
            handleFile(req, res, origin);
            return;
        }
        if (req.method !== 'POST') {
            setCORS(res, origin);
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        const bodyStr = await getBody(req);
        let parsedBody;
        try {
            parsedBody = JSON.parse(bodyStr);
        }
        catch {
            sendJSON(res, 400, { error: 'Invalid JSON' }, origin);
            return;
        }
        if (url === '/inject') {
            // Replace entire file content (original behavior)
            const code = parsedBody.code;
            const filename = parsedBody.filename;
            if (typeof code !== 'string') {
                sendJSON(res, 400, { error: 'Missing "code" field' }, origin);
                return;
            }
            const editor = pickEditor(typeof filename === 'string' ? filename : undefined);
            if (!editor) {
                sendJSON(res, 400, { error: 'No active editor' }, origin);
                return;
            }
            const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
            await editor.edit((eb) => {
                eb.replace(fullRange, code);
            });
            await editor.document.save();
            vscode.window.showInformationMessage('Code injected by FOUNDRY');
            sendJSON(res, 200, { status: 'ok' }, origin);
        }
        else if (url === '/insert') {
            await handleInsert(parsedBody, origin, res);
        }
        else if (url === '/command') {
            await handleCommand(parsedBody, origin, res);
        }
        else if (url === '/open') {
            await handleOpen(parsedBody, origin, res);
        }
        else {
            setCORS(res, origin);
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    });
    server.listen(7700, '127.0.0.1', () => {
        console.log('FOUNDRY server running on http://127.0.0.1:7700');
    });
    context.subscriptions.push({
        dispose: () => { server.close(); },
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map