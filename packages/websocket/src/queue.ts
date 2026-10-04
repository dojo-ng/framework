// Internal module: a self-contained singly linked list, with only what the dispatcher's send
// queue needs and no dependencies. Never re-export this module from index.ts: it is an
// implementation detail, not public API.

interface Node<T> {
	value: T;
	next: Node<T> | null;
}

/** A FIFO queue backed by a singly linked list: enqueue, dequeue, and pushfront are all O(1). */
export class Queue<T> {
	private head: Node<T> | null = null;
	private tail: Node<T> | null = null;
	private length = 0;

	/** Inserts the element at the end of the queue. Returns false if `elem` is undefined. */
	enqueue(elem: T): boolean {
		return this.add(elem);
	}

	/** Same as `enqueue`. */
	add(elem: T): boolean {
		if (elem === undefined) return false;
		const node: Node<T> = { value: elem, next: null };
		if (this.tail) {
			this.tail.next = node;
		} else {
			this.head = node;
		}
		this.tail = node;
		this.length++;
		return true;
	}

	/** Inserts the element at the front of the queue. Returns false if `elem` is undefined. */
	pushfront(elem: T): boolean {
		if (elem === undefined) return false;
		this.head = { value: elem, next: this.head };
		if (!this.tail) this.tail = this.head;
		this.length++;
		return true;
	}

	/** Removes and returns the head of the queue, or undefined if empty. */
	dequeue(): T | undefined {
		const node = this.head;
		if (!node) return undefined;
		this.head = node.next;
		if (!this.head) this.tail = null;
		this.length--;
		return node.value;
	}

	/** Returns the head of the queue without removing it, or undefined if empty. */
	peek(): T | undefined {
		return this.head?.value;
	}

	size(): number {
		return this.length;
	}

	count(): number {
		return this.length;
	}

	isEmpty(): boolean {
		return this.length === 0;
	}

	clear(): void {
		this.head = null;
		this.tail = null;
		this.length = 0;
	}

	/** Visits each element FIFO order. A callback returning `false` stops the iteration. */
	forEach(callback: (elem: T) => boolean | void): void {
		let node = this.head;
		while (node !== null) {
			if (callback(node.value) === false) break;
			node = node.next;
		}
	}
}
