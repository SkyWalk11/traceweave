function sendReceipt(orderId, userId) {
  const payload = buildPayload(orderId, userId);
  return dispatch(payload);
}

function buildPayload(orderId, userId) {
  return { orderId, userId, channel: "email" };
}
