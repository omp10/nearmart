/** Every success body has this shape, so clients read `data` the same way everywhere. */
export const ok = (res, data = null, message = 'OK', status = 200) =>
    res.status(status).json({ success: true, message, data });

export const created = (res, data = null, message = 'Created') => ok(res, data, message, 201);
