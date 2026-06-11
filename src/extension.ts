import * as http from 'http';
import * as vscode from 'vscode';
import * as path from 'path';

function setCORS(res: http.ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJSON(res: http.ServerResponse, code: number, data: Record<string, unknown>, origin: string): void {
  setCORS(res, origin);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify(data));
}

function getBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function pickEditor(filename: string | undefined): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active) return active;
  if (filename && filename.length > 0) {
    return vscode.window.visibleTextEditors.find((e) =>
      e.document.fileName.endsWith(filename)
    );
  }
  return undefined;
}

// ── /insert position parsing ────────────────────────────────────

type PositionKind = 'end' | 'start' | 'afterFunction' | 'line';

interface ParsedPosition {
  kind: PositionKind;
  name?: string;
  line?: number;
}

function parsePosition(raw: string): ParsedPosition {
  if (raw === 'end') return { kind: 'end' };
  if (raw === 'start') return { kind: 'start' };
  const m = raw.match(/^after:(.+)$/);
  if (m) return { kind: 'afterFunction', name: m[1] };
  const n = parseInt(raw, 10);
  if (!isNaN(n) && n > 0) return { kind: 'line', line: n };
  return { kind: 'end' };
}

function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchingBrace(text: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

function locateFunctionEnd(text: string, name: string): number {
  const patterns: RegExp[] = [
    new RegExp(`function\\s+${escRegex(name)}\\s*\\(`, 'g'),
    new RegExp(`${escRegex(name)}\\s*=\\s*function\\s*\\(`, 'g'),
    new RegExp(`${escRegex(name)}\\s*=\\s*\\(?[^)]*\\)?\\s*(?:=>|{)`, 'g'),
    new RegExp(`${escRegex(name)}\\s*\\([^)]*\\)\\s*{`, 'g'),
    new RegExp(`def\\s+${escRegex(name)}\\s*\\(`, 'g'),
    new RegExp(`func\\s+${escRegex(name)}\\s*\\(`, 'g'),
    new RegExp(`fn\\s+${escRegex(name)}\\s*\\(`, 'g'),
  ];
  for (const p of patterns) {
    let match: RegExpExecArray | null;
    while ((match = p.exec(text)) !== null) {
      const brace = text.indexOf('{', match.index);
      if (brace === -1) continue;
      const end = matchingBrace(text, brace);
      if (end !== -1) return end;
    }
  }
  return -1;
}

// ── /insert ─────────────────────────────────────────────────────

async function handleInsert(body: Record<string, unknown>, origin: string, res: http.ServerResponse): Promise<void> {
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
  let insertAt: vscode.Position;

  switch (pos.kind) {
    case 'start':
      insertAt = doc.positionAt(0);
      break;
    case 'end':
      insertAt = doc.positionAt(text.length);
      break;
    case 'line': {
      const line = Math.max(1, pos.line!);
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
  await editor.edit((eb: vscode.TextEditorEdit) => {
    eb.insert(insertAt, code + suffix);
  });

  await editor.document.save();
  vscode.window.showInformationMessage('Code injected by FOUNDRY');
  sendJSON(res, 200, { status: 'ok' }, origin);
}

// ── /command ────────────────────────────────────────────────────

async function handleCommand(body: Record<string, unknown>, origin: string, res: http.ServerResponse): Promise<void> {
  const cmd = body.command;
  if (typeof cmd !== 'string' || cmd.length === 0) {
    sendJSON(res, 400, { error: 'Missing "command" field' }, origin);
    return;
  }

  let terminal: vscode.Terminal;
  const existing = vscode.window.terminals;
  if (existing.length > 0) {
    terminal = existing[0];
  } else {
    terminal = vscode.window.createTerminal('FOUNDRY');
  }

  terminal.show();
  terminal.sendText(cmd, true);

  vscode.window.showInformationMessage('FOUNDRY: Running command');
  sendJSON(res, 200, { status: 'ok', command: cmd }, origin);
}

// ── /open ────────────────────────────────────────────────────────

async function handleOpen(body: Record<string, unknown>, origin: string, res: http.ServerResponse): Promise<void> {
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

// ── Server ──────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin: string = req.headers.origin ?? '*';

    // CORS preflight for any URL
    if (req.method === 'OPTIONS') {
      setCORS(res, origin);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      setCORS(res, origin);
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const bodyStr: string = await getBody(req);
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(bodyStr) as Record<string, unknown>;
    } catch {
      sendJSON(res, 400, { error: 'Invalid JSON' }, origin);
      return;
    }

    const url: string | undefined = req.url;

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

      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length)
      );

      await editor.edit((eb: vscode.TextEditorEdit) => {
        eb.replace(fullRange, code);
      });

      await editor.document.save();
      vscode.window.showInformationMessage('Code injected by FOUNDRY');
      sendJSON(res, 200, { status: 'ok' }, origin);
    } else if (url === '/insert') {
      await handleInsert(parsedBody, origin, res);
    } else if (url === '/command') {
      await handleCommand(parsedBody, origin, res);
    } else if (url === '/open') {
      await handleOpen(parsedBody, origin, res);
    } else {
      setCORS(res, origin);
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(7700, '127.0.0.1', () => {
    console.log('FOUNDRY server running on http://127.0.0.1:7700');
  });

  context.subscriptions.push({
    dispose: (): void => { server.close(); },
  });
}

export function deactivate(): void {}
