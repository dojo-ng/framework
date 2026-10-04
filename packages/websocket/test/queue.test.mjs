/**
 * Queue: enqueue/dequeue/peek/isEmpty/size/clear, FIFO order, pushfront, forEach early-break.
 * Pure — no DOM.
 *
 * Run: node --test test/queue.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Queue } from "../dist/queue.js";

test("constructor creates an empty queue", () => {
	const q = new Queue();
	assert.equal(q.size(), 0);
	assert.equal(q.count(), 0);
	assert.equal(q.isEmpty(), true);
	assert.equal(q.peek(), undefined);
});

test("queue is FIFO", () => {
	const q = new Queue();
	assert.equal(q.enqueue("a"), true);
	assert.equal(q.peek(), "a");
	assert.equal(q.add("b"), true);
	assert.equal(q.peek(), "a");
	assert.equal(q.dequeue(), "a");
	assert.equal(q.peek(), "b");
});

test("dequeue on empty returns undefined and does not underflow", () => {
	const q = new Queue();
	assert.equal(q.dequeue(), undefined);
	assert.equal(q.isEmpty(), true);
	q.enqueue("a");
	assert.equal(q.dequeue(), "a");
	assert.equal(q.dequeue(), undefined);
	assert.equal(q.isEmpty(), true);
});

test("clear removes all elements", () => {
	const q = new Queue();
	assert.equal(q.isEmpty(), true);
	q.enqueue("a");
	q.enqueue("b");
	q.enqueue("c");
	assert.equal(q.isEmpty(), false);
	assert.equal(q.size(), 3);
	q.clear();
	assert.equal(q.isEmpty(), true);
	assert.equal(q.size(), 0);
	assert.equal(q.peek(), undefined);
});

test("enqueue after clear works and stays FIFO", () => {
	const q = new Queue();
	q.enqueue("a");
	q.enqueue("b");
	q.clear();
	assert.equal(q.enqueue("c"), true);
	assert.equal(q.enqueue("d"), true);
	assert.equal(q.size(), 2);
	assert.equal(q.dequeue(), "c");
	assert.equal(q.dequeue(), "d");
	assert.equal(q.dequeue(), undefined);
});

test("pushfront inserts at the head", () => {
	const q = new Queue();
	assert.equal(q.pushfront("a"), true);
	assert.equal(q.peek(), "a");
	assert.equal(q.pushfront("b"), true);
	assert.equal(q.peek(), "b");
	assert.equal(q.pushfront("c"), true);
	assert.equal(q.peek(), "c");
	assert.deepEqual([q.dequeue(), q.dequeue(), q.dequeue()], ["c", "b", "a"]);
});

test("forEach visits in FIFO order and can break early by returning false", () => {
	const q = new Queue();
	q.add("a");
	q.add("b");
	q.add("c");
	const seen = [];
	q.forEach((elem) => {
		seen.push(elem);
		if (elem === "b") return false;
	});
	assert.deepEqual(seen, ["a", "b"]);
});
