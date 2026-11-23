class ApiError extends Error {
  constructor(status, error, code, details = []) {
    super(error);
    this.status = status;
    this.error = error;
    this.code = code;
    this.details = details;
  }
}

class ItemService {
  constructor(itemRepository) {
    this.itemRepository = itemRepository;
  }

  validateItemPayload(data) {
    const details = [];

    if (!data || typeof data.name !== 'string' || data.name.trim().length === 0) {
      details.push({ field: 'name', message: "Назва товару є обов'язковою" });
    }

    if (!Number.isFinite(data?.price) || data.price <= 0) {
      details.push({ field: 'price', message: 'Ціна повинна бути додатним числом' });
    }

    const stockQuantity = data?.stockQuantity ?? 0;
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      details.push({ field: 'stockQuantity', message: 'Кількість на складі не може бути від’ємною' });
    }

    if (details.length > 0) {
      throw new ApiError(400, 'ValidationError', 'INVALID_INPUT', details);
    }

    return {
      name: data.name.trim(),
      price: data.price,
      stockQuantity,
    };
  }

  async getAllItems() {
    return this.itemRepository.findAll();
  }

  async getItemById(id) {
    const item = await this.itemRepository.findById(id);
    if (!item) {
      throw new ApiError(404, 'NotFoundError', 'ITEM_NOT_FOUND', [
        { field: 'id', message: `Товар з ID ${id} не знайдено` },
      ]);
    }
    return item;
  }

  async createItem(payload, idempotencyKey) {
    const product = this.validateItemPayload(payload);
    if (idempotencyKey === undefined) return this.itemRepository.create(product);

    const saved = await this.itemRepository.createIdempotent(idempotencyKey, product);
    if (saved.name !== product.name || saved.price !== product.price ||
        saved.stockQuantity !== product.stockQuantity) {
      throw new ApiError(409, 'idempotency_conflict', 'IDEMPOTENCY_KEY_CONFLICT', [
        { field: 'Idempotency-Key', message: 'Цей ключ уже використано для іншого товару' },
      ]);
    }
    return saved;
  }

  async updateItem(id, payload) {
    const validData = this.validateItemPayload(payload);
    const updated = await this.itemRepository.update(id, validData);
    if (!updated) {
      throw new ApiError(404, 'NotFoundError', 'ITEM_NOT_FOUND', [
        { field: 'id', message: `Товар з ID ${id} не знайдено` },
      ]);
    }
    return updated;
  }

  async deleteItem(id) {
    const deleted = await this.itemRepository.delete(id);
    if (!deleted) {
      throw new ApiError(404, 'NotFoundError', 'ITEM_NOT_FOUND', [
        { field: 'id', message: `Товар з ID ${id} не знайдено` },
      ]);
    }
  }
}

module.exports = { ItemService, ApiError };