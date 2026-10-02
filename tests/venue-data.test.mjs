import test from "node:test";
import assert from "node:assert/strict";
import { citationVenue } from "../site/assets/venue-data.js";

test("full metadata distinguishes venues that share the same truncated Scholar snippet", () => {
  const metadata = { a: { name: "Full Conference A" }, b: { name: "Full Conference B" } };
  assert.equal(citationVenue({ citing_link: "a", citing_venue: "Proceedings of the …" }, metadata), "Full Conference A");
  assert.equal(citationVenue({ citing_link: "b", citing_venue: "Proceedings of the …" }, metadata), "Full Conference B");
});

test("arXiv snippets combine under one complete repository name", () => {
  for (const name of ["arXiv preprint arXiv …", "arXiv preprint arXiv:2604.16279", "arXiv"]) {
    assert.equal(citationVenue({ citing_venue: name }), "arXiv");
  }
});

test("unrecoverable fragments are omitted rather than presented as full venue names", () => {
  for (const name of ["Proceedings of the …", "Findings of...", "Proceedings of the", ""]) {
    assert.equal(citationVenue({ citing_venue: name }), null);
  }
  assert.equal(citationVenue({ citing_venue: "European Conference on Information Retrieval" }), "European Conference on Information Retrieval");
});
