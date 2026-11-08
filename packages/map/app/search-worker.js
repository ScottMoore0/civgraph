const state = {
  maps: []
};

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    state.maps = Array.isArray(message.maps) ? message.maps.map(normalizeMapRecord) : [];
    self.postMessage({ type: 'ready', count: state.maps.length });
    return;
  }
  if (message.type === 'search') {
    const query = normalizeText(message.query || '');
    const limit = Math.max(1, Math.min(Number(message.limit || 200), 1000));
    const ids = search(query, limit);
    self.postMessage({ type: 'results', seq: message.seq, query: message.query || '', ids });
  }
});

function normalizeMapRecord(map) {
  const fields = [
    map.id,
    map.name,
    map.category,
    map.group,
    map.provider,
    map.description,
    map.date,
    map.dateRange,
    ...(Array.isArray(map.keywords) ? map.keywords : [])
  ];
  return {
    id: map.id,
    name: String(map.name || ''),
    text: normalizeText(fields.flat().filter(Boolean).join(' '))
  };
}

function search(query, limit) {
  if (!query) return [];
  const terms = query.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const item of state.maps) {
    let score = 0;
    let matched = true;
    const itemName = normalizeText(item.name);
    for (const term of terms) {
      const nameIndex = itemName.indexOf(term);
      const textIndex = item.text.indexOf(term);
      if (nameIndex === -1 && textIndex === -1) {
        matched = false;
        break;
      }
      score += nameIndex === 0 ? 100 : (nameIndex > 0 ? 65 : 20);
      score += textIndex === 0 ? 30 : (textIndex > 0 ? 8 : 0);
    }
    if (matched) scored.push({ id: item.id, score, name: item.name });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((item) => item.id);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
