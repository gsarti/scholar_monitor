// Scholar snippets can truncate venue names before they reach our saved data.
export function citationVenue(row, metadata = {}) {
  const name = (metadata[row.citing_link]?.name || row.citing_venue || "").trim();
  if (/^arxiv preprint\b/i.test(name)) return "arXiv";
  if (!name || /…|\.{3}|\b(?:of|of the|on|on the|in|in the)$/i.test(name)) return null;
  return name;
}
