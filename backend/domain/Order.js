class OrderItem {
  constructor({ productId, productName, unitPrice, quantity }) {
    if (quantity <= 0) {
      throw new Error("Кількість має бути більшою за 0");
    }
    this.productId = productId;
    this.productName = productName;
    this.unitPrice = Number(unitPrice);
    this.quantity = Number(quantity);
  }

  getSubtotal() {
    return this.unitPrice * this.quantity;
  }
}

class Order {
  constructor({ id, customerId, items = [], status = "NEW", createdAt = new Date().toISOString() }) {
    this.id = id;
    this.customerId = customerId;
    this.items = items.map((item) => (item instanceof OrderItem ? item : new OrderItem(item)));
    this.status = status;
    this.createdAt = createdAt;
  }

  addItem(product, quantity = 1) {
    if (this.status !== "NEW") {
      throw new Error("Не можна змінювати замовлення, яке вже не в статусі NEW");
    }
    const existing = this.items.find((i) => i.productId === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push(
        new OrderItem({
          productId: product.id,
          productName: product.name,
          unitPrice: product.price,
          quantity,
        })
      );
    }
  }

  getTotalAmount() {
    return this.items.reduce((sum, item) => sum + item.getSubtotal(), 0);
  }

  markAsPaid() {
    if (this.items.length === 0) {
      throw new Error("Не можна оплатити порожнє замовлення");
    }
    this.status = "PAID";
  }
}

module.exports = { Order, OrderItem };