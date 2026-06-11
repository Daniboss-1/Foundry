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
const vscode = __importStar(require("vscode"));
// VS Code extensions sometimes get limited Node typings in the TS server; keep this file typed safely.
function activate(context) {
    const server = http.createServer(async (req, res) => {
        // Always reply with the right CORS headers (DeepSeek/Chrome often sends a preflight OPTIONS)
        const origin = req.headers.origin;
        res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
        if (req.method === 'OPTIONS' && req.url === '/inject') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method !== 'POST' || req.url !== '/inject') {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { code, filename } = JSON.parse(body);
                if (typeof code !== 'string') {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing "code" field' }));
                    return;
                }
                let editor = vscode.window.activeTextEditor;
                if (!editor && typeof filename === 'string' && filename.length > 0) {
                    const matching = vscode.window.visibleTextEditors.find((e) => e.document.fileName.endsWith(filename));
                    if (matching) {
                        editor = matching;
                    }
                }
                if (!editor) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'No active editor' }));
                    return;
                }
                const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
                await editor.edit((editBuilder) => {
                    editBuilder.replace(fullRange, code);
                });
                await editor.document.save();
                vscode.window.showInformationMessage('Code injected by FOUNDRY');
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Allow-Methods", "POST");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type");
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            }
            catch {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    });
    server.listen(7700, '127.0.0.1', () => {
        console.log('FOUNDRY server running on http://127.0.0.1:7700');
    });
    context.subscriptions.push({
        dispose: () => server.close(),
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map