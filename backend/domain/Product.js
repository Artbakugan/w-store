class Product {
  constructor({ id, name, price, stockQuantity = 0, categoryId = null }) {
    if (!name || name.trim() === "") {
      throw new Error("Назва товару є обов'язковою");
    }
    if (price < 0) {
      throw new Error("Ціна товару не може бути від'ємною");
    }
    this.id = id;
    this.name = name.trim();
    this.price = Number(price);
    this.stockQuantity = Number(stockQuantity);
    this.categoryId = categoryId;
  }

  isAvailable(requestedQty = 1) {
    return this.stockQuantity >= requestedQty;
  }

  reserveStock(qty) {
    if (!this.isAvailable(qty)) {
      throw new Error(`Недостатньо товару "${this.name}" на складі`);
    }
    this.stockQuantity -= qty;
  }
}

module.exports = { Product };