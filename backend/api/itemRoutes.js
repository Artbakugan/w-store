const express = require('express');
const { ApiError } = require('../service/itemService');

function createItemRouter(itemService) {
  const router = express.Router();

  const handleError = (res, err) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({
        error: err.error,
        code: err.code,
        details: err.details,
      });
    }
    console.error(err);
    return res.status(500).json({
      error: 'InternalServerError',
      code: 'INTERNAL_ERROR',
      details: [],
    });
  };

  router.get('/', async (req, res) => {
    try {
      const items = await itemService.getAllItems();
      res.status(200).json(items);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, 'ValidationError', 'INVALID_ID', [
          { field: 'id', message: 'Некоректний ID товару' },
        ]);
      }
      const item = await itemService.getItemById(id);
      res.status(200).json(item);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const created = await itemService.createItem(req.body);
      res.status(201).json(created);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, 'ValidationError', 'INVALID_ID', [
          { field: 'id', message: 'Некоректний ID товару' },
        ]);
      }
      const updated = await itemService.updateItem(id, req.body);
      res.status(200).json(updated);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, 'ValidationError', 'INVALID_ID', [
          { field: 'id', message: 'Некоректний ID товару' },
        ]);
      }
      await itemService.deleteItem(id);
      res.status(204).send();
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

module.exports = { createItemRouter };