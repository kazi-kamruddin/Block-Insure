// Offline context contract. Only observable fields survive this boundary.
const DAY = 86400000;
function observation(record) {
  const time = Date.parse(record.observationDate || record.admissionDate) / DAY;
  const amount = Number(record.billAmount);
  if (!Number.isFinite(time) || !Number.isFinite(amount) || amount < 0 || !record.patientHash || !record.hospitalId) return null;
  return { time, amount, patient: record.patientHash, provider: record.hospitalId,
    treatment: String(record.treatmentType || ''), diagnosis: String(record.diagnosisCode || '') };
}
const lower = (rows, time) => { let l = 0, r = rows.length; while (l < r) { const m = (l + r) >>> 1; if (rows[m].time < time) l = m + 1; else r = m; } return l; };
const ordered = (a, b) => { if (a.time !== b.time) return a.time - b.time; const ka = JSON.stringify(a), kb = JSON.stringify(b); return ka < kb ? -1 : ka > kb ? 1 : 0; };
function createContextIndex() {
  const patients = new Map(), providers = new Map(); let sealed = false;
  return {
    add(record) { if (sealed) throw new Error('Context is sealed'); const row = observation(record); if (!row) return;
      for (const [map, key] of [[patients, row.patient], [providers, row.provider]]) { if (!map.has(key)) map.set(key, []); map.get(key).push(row); } },
    seal() { for (const map of [patients, providers]) for (const rows of map.values()) rows.sort(ordered); sealed = true; },
    series() { if (!sealed) throw new Error('Seal context first'); return [...providers.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([, rows]) => rows.length >= 10).slice(0, 200).map(([, rows]) => rows.map((row) => row.time)); },
    query(record, episodeRecords = []) {
      if (!sealed) throw new Error('Seal context first'); const current = observation(record); if (!current) throw new Error('Invalid observable context');
      const window = (map, key) => { const rows = map.get(key) || []; return rows.slice(lower(rows, current.time - 90), lower(rows, current.time)); };
      const extra = episodeRecords.map(observation).filter((row) => row && row.time < current.time && row.time >= current.time - 90);
      const p = [...window(patients, current.patient), ...extra.filter((row) => row.patient === current.patient)].sort(ordered);
      const h = [...window(providers, current.provider), ...extra.filter((row) => row.provider === current.provider)].sort(ordered);
      const provider30 = h.filter((row) => row.time >= current.time - 30), patient14 = p.filter((row) => row.time >= current.time - 14);
      const counts = new Map(); for (const row of h) counts.set(row.patient, (counts.get(row.patient) || 0) + 1);
      const graph = [...new Set([...p, ...h])];
      // Normalized bipartite propagation on the strictly-prior local ego graph.
      // Uniform priors: structural ranking, NOT fraud-seeded risk propagation.
      const left = [...new Set(graph.map((row) => row.patient))].sort(), right = [...new Set(graph.map((row) => row.provider))].sort();
      const edges = new Map(), ld = new Map(), rd = new Map();
      for (const row of graph) { const key = JSON.stringify([row.patient, row.provider]); edges.set(key, (edges.get(key) || 0) + 1); ld.set(row.patient, (ld.get(row.patient) || 0) + 1); rd.set(row.provider, (rd.get(row.provider) || 0) + 1); }
      let ls = new Map(left.map((id) => [id, 1 / left.length])), rs = new Map(right.map((id) => [id, 1 / right.length]));
      for (let iteration = 0; iteration < 12; iteration++) {
        const nl = new Map(left.map((id) => [id, 0.15 / left.length])), nr = new Map(right.map((id) => [id, 0.15 / right.length]));
        for (const [key, weight] of edges) { const [a, b] = JSON.parse(key), scale = weight / Math.sqrt(ld.get(a) * rd.get(b)); nl.set(a, nl.get(a) + 0.85 * scale * rs.get(b)); nr.set(b, nr.get(b) + 0.85 * scale * ls.get(a)); }
        ls = nl; rs = nr;
      }
      const similar = patient14.filter((row) => row.provider === current.provider && row.treatment === current.treatment && current.diagnosis && row.diagnosis === current.diagnosis && Math.abs(row.amount - current.amount) / Math.max(row.amount, current.amount, 1e-6) <= 0.1);
      return {
        features: { history_similar: Math.log1p(similar.length), history_patient14: Math.log1p(patient14.length), history_provider30: Math.log1p(provider30.length),
          history_provider_mean_bill: provider30.length ? provider30.reduce((sum, row) => sum + Math.log1p(row.amount), 0) / provider30.length : 0,
          graph_patient_degree: Math.log1p(new Set(p.map((row) => row.provider)).size), graph_provider_degree: Math.log1p(counts.size),
          graph_edge_repeat_share: h.length ? (counts.get(current.patient) || 0) / h.length : 0,
          graph_provider_hhi: h.length ? [...counts.values()].reduce((sum, n) => sum + (n / h.length) ** 2, 0) : 0,
          graph_birank_patient: ls.get(current.patient) || 0, graph_birank_provider: rs.get(current.provider) || 0,
          temporal_provider7: Math.log1p(h.filter((row) => row.time >= current.time - 7).length),
          temporal_history_available: Number(h.length > 0), history_available: Number(p.length + h.length > 0) },
        providerLags: h.map((row) => current.time - row.time),
      };
    },
  };
}
module.exports = { observation, createContextIndex };
