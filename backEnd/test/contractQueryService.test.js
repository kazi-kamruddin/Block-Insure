const assert = require("node:assert/strict");
const test = require("node:test");
const {
  paginate,
  parsePagination,
} = require("../services/contractQueryService");

test("normalizes and caps API pagination", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 50 });
  assert.deepEqual(parsePagination({ page: "2", limit: "25" }), {
    page: 2,
    limit: 25,
  });
  assert.deepEqual(parsePagination({ page: "-1", limit: "1000" }), {
    page: 1,
    limit: 100,
  });
});

test("returns bounded pages with navigation metadata", () => {
  const result = paginate([1, 2, 3, 4, 5], { page: 2, limit: 2 });

  assert.deepEqual(result.items, [3, 4]);
  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 2,
    total: 5,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});
