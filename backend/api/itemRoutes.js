const express = require('express');
const { ApiError } = require('../service/itemService');

function createItemRouter(itemService) {
  const router = express.Router();

  router.param('id', (req, _res, next, value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return next(new ApiError(400, 'ValidationError', 'INVALID_ID', [
        { field: 'id', message: 'Некоректний ID товару' },
      ]));
    }
    req.itemId = id;
    next();
  });

  router.get('/', async (_req, res) => {
    res.json(await itemService.getAllItems());
  });

  router.get('/:id', async (req, res) => {
    res.json(await itemService.getItemById(req.itemId));
  });

  router.post('/', async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key?.trim()) {
      throw new ApiError(400, 'idempotency_key_required', 'MISSING_IDEMPOTENCY_KEY', [
        { field: 'Idempotency-Key', message: 'Заголовок Idempotency-Key є обов’язковим' },
      ]);
    }

    const created = await itemService.createItem(req.body, key);
    res.status(201).json({ ...created, requestId: req.rid });
  });

  router.put('/:id', async (req, res) => {
    res.json(await itemService.updateItem(req.itemId, req.body));
  });

  router.delete('/:id', async (req, res) => {
    await itemService.deleteItem(req.itemId);
    res.status(204).end();
  });

  return router;
}

module.exports = { createItemRouter };
