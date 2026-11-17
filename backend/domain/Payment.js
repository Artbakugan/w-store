class Payment {
  constructor({ id, orderId, amount, status = "PENDING", paidAt = null }) {
    if (amount <= 0) {
      throw new Error("Сума платежу має бути додатною");
    }
    this.id = id;
    this.orderId = orderId;
    this.amount = Number(amount);
    this.status = status;
    this.paidAt = paidAt;
  }

  complete() {
    if (this.status === "SUCCEEDED") {
      throw new Error("Платіж уже проведено");
    }
    this.status = "SUCCEEDED";
    this.paidAt = new Date().toISOString();
  }
}

module.exports = { Payment };