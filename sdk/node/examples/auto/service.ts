// Zero instrumentation in this file — proves the /auto hook captures
// requests with no recordStep() calls anywhere in application code.
// Run with: npm run example:auto
// Then hit: curl -X POST localhost:5003/anything -d '{"hello":"world"}' -H 'Content-Type: application/json'
import http from "node:http";

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  })
  .listen(5003, () => console.log("auto-example listening on :5003"));
