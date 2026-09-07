(function () {
  const objects = new Map();

  function key(type, id) {
    return `${String(type || '').trim()}:${String(id || '').trim()}`;
  }

  function cleanValue(value, max = 220) {
    if (value == null) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function compactMetadata(metadata = {}) {
    return Object.fromEntries(Object.entries(metadata)
      .filter(([, value]) => value != null && value !== '')
      .slice(0, 10)
      .map(([name, value]) => [cleanValue(name, 48), cleanValue(value)]));
  }

  function toReference(record) {
    if (!record) return null;
    return {
      type: record.type,
      id: record.id,
      label: record.label,
      page: record.page,
      metadata: { ...record.metadata }
    };
  }

  function register(input, element) {
    const type = cleanValue(input?.type || element?.dataset?.kyleType, 48);
    const id = cleanValue(input?.id || element?.dataset?.kyleId, 180);
    if (!type || !id) return null;

    const previous = objects.get(key(type, id));
    const record = {
      type,
      id,
      label: cleanValue(input?.label || element?.dataset?.kyleLabel || previous?.label || id),
      page: cleanValue(input?.page || previous?.page || '', 48),
      metadata: compactMetadata({ ...(previous?.metadata || {}), ...(input?.metadata || {}) }),
      element: element || previous?.element || null,
      updatedAt: Date.now()
    };

    if (record.element) {
      record.element.dataset.kyleType = type;
      record.element.dataset.kyleId = id;
      record.element.dataset.kyleLabel = record.label;
    }
    objects.set(key(type, id), record);
    return toReference(record);
  }

  function unregister(type, id) {
    objects.delete(key(type, id));
  }

  function unregisterType(type) {
    for (const [recordKey, record] of objects) {
      if (record.type === type) objects.delete(recordKey);
    }
  }

  function get(type, id) {
    return toReference(objects.get(key(type, id)));
  }

  function getRecord(reference) {
    if (!reference?.type || !reference?.id) return null;
    return objects.get(key(reference.type, reference.id)) || null;
  }

  function getElement(reference) {
    const record = getRecord(reference);
    return record?.element?.isConnected ? record.element : null;
  }

  function getFromElement(element) {
    const target = element?.closest?.('[data-kyle-type][data-kyle-id]');
    if (!target) return null;
    const record = objects.get(key(target.dataset.kyleType, target.dataset.kyleId));
    return record ? toReference(record) : register({}, target);
  }

  function isVisible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function listVisible({ page, type, limit = 16 } = {}) {
    return [...objects.values()]
      .filter(record => (!page || !record.page || record.page === page) && (!type || record.type === type))
      .filter(record => isVisible(record.element))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(toReference);
  }

  function list({ type, page, limit = 40 } = {}) {
    return [...objects.values()]
      .filter(record => (!type || record.type === type) && (!page || record.page === page))
      .slice(0, limit)
      .map(toReference);
  }

  window.MailmateObjects = {
    register,
    unregister,
    unregisterType,
    get,
    getElement,
    getFromElement,
    list,
    listVisible
  };
})();
