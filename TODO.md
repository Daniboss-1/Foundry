# TODO

- [ ] Analyze request origin / CORS behavior causing “content refused” in Chrome/DeepSeek.
- [ ] Update extension server to properly handle CORS preflight (OPTIONS) and only set headers when responding.
- [ ] Update server to respond to OPTIONS /inject with correct Access-Control headers.
- [ ] Rebuild TypeScript (npm run compile) and verify server still injects code.
- [ ] (Optional) Add explicit Content-Length and ensure JSON response always sent after headers.

