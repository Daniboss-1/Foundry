import * as http from 'http';
import * as vscode from 'vscode';

// VS Code extensions sometimes get limited Node typings in the TS server; keep this file typed safely.


export function activate(context: vscode.ExtensionContext) {
  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin ?? '*';

    if (req.method === 'OPTIONS' && req.url === '/inject') {
      // Handle preflight request
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/inject') {
      // Handle 404 - still set CORS headers for consistency
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.writeHead(404);
      res.end('Not Found');
      return;
    }



    let body = '';
    req.on('data', (chunk: Buffer | string) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { code, filename } = JSON.parse(body);
        if (typeof code !== 'string') {
          // Handle 400 - Missing code field
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Access-Control-Max-Age', '86400');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing "code" field' }));
          return;
        }

        let editor = vscode.window.activeTextEditor;

        if (!editor && typeof filename === 'string' && filename.length > 0) {
          const matching = vscode.window.visibleTextEditors.find((e) =>
            e.document.fileName.endsWith(filename)
          );
          if (matching) {
            editor = matching;
          }
        }

        if (!editor) {
          // Handle 400 - No active editor
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Access-Control-Max-Age', '86400');
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No active editor' }));
          return;
        }

        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length)
        );

        await editor.edit((editBuilder) => {
          editBuilder.replace(fullRange, code);
        });

        await editor.document.save();

        vscode.window.showInformationMessage('Code injected by FOUNDRY');

        // Handle successful response
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
      } catch {
        // Handle 400 - Invalid JSON
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
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

export function deactivate() {}
