// Pointer snapping for the project links.
//
// iPadOS only gives its magnetic pointer to UIKit controls, so a link in a web
// page never earns one no matter how it is marked up — a bare <a> and a plain
// <button> both come up empty on device. A page also cannot move the physical
// cursor, so the snap runs the other way round: the nearest link inside
// SNAP_RADIUS lights up as the cursor approaches, before it has actually
// arrived. Same effect from a Universal Control trackpad, a mouse, or a
// Magic Trackpad, since it rides on ordinary pointer events.
const SNAP_RADIUS = 80;

document.addEventListener("DOMContentLoaded", () => {
	const wrappers = Array.from(document.querySelectorAll(".underline"));
	if (!wrappers.length) return;

	let snapped = null;

	// Zero once the cursor is inside the box, so an enclosing link always wins.
	const distanceTo = (rect, x, y) => {
		const dx = Math.max(rect.left - x, 0, x - rect.right);
		const dy = Math.max(rect.top - y, 0, y - rect.bottom);
		return Math.hypot(dx, dy);
	};

	const setSnapped = (wrapper) => {
		if (snapped === wrapper) return;
		if (snapped) snapped.classList.remove("is-snapped");
		if (wrapper) wrapper.classList.add("is-snapped");
		snapped = wrapper;
	};

	const update = (x, y) => {
		let nearest = null;
		let shortest = SNAP_RADIUS;

		for (const wrapper of wrappers) {
			const distance = distanceTo(wrapper.getBoundingClientRect(), x, y);
			if (distance <= shortest) {
				shortest = distance;
				nearest = wrapper;
			}
		}

		setSnapped(nearest);
	};

	// Capture phase on window, matching pencil-ink.js: it stops pen events from
	// propagating, and a same-node same-phase listener still runs, so this keeps
	// seeing them and can drop the snap while the Pencil draws.
	window.addEventListener(
		"pointermove",
		(event) => {
			// A finger has no cursor to snap, and the Pencil is drawing, not pointing.
			if (isPenPointer(event) || event.pointerType === "touch") {
				setSnapped(null);
				return;
			}
			update(event.clientX, event.clientY);
		},
		{ capture: true, passive: true },
	);

	const clear = () => setSnapped(null);
	document.documentElement.addEventListener("pointerleave", clear);
	window.addEventListener("blur", clear);
	window.addEventListener("pagehide", clear);
});
