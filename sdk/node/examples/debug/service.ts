// Disposable target for testing the debug-agent logpoint mechanism safely,
// before pointing it at anything real. No recordStep() calls — this is
// purely to verify breakpoint-hit capture actually works and doesn't hang.
import http from "node:http";

function handleOrder(userId: string, items: string[]) {
  const total = items.length * 1000;
  const summary = { userId, itemCount: items.length, total };
  return summary;
}

http
  .createServer((req, res) => {
    const result = handleOrder("u_42", ["sku_a", "sku_b", "sku_c"]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  })
  .listen(5004, () => console.log("debug-test listening on :5004"));
