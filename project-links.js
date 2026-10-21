// Feature flag: 3D tilt-and-recoil on the project links. Set to false to fall
// back to the flat scale-down/burst animation.
const TILT_ENABLED = false;
const TILT_DEGREES = 16;
const PRESS_DEPTH = 22;

document.documentElement.classList.toggle("tilt", TILT_ENABLED);

document.addEventListener("DOMContentLoaded", () => {
	const wrappers = document.querySelectorAll(".underline");
	if (!wrappers.length) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const clampToEdge = (value) => Math.max(-1, Math.min(1, value));

	// Positive rotateY tips the right edge away from the viewer, positive rotateX
	// tips the bottom edge toward it, so the clicked point is what sinks inward.
	const pressTransform = (link, event) => {
		const rect = link.getBoundingClientRect();
		const nx = clampToEdge(((event.clientX - rect.left) / rect.width) * 2 - 1);
		const ny = clampToEdge(((event.clientY - rect.top) / rect.height) * 2 - 1);
		return `perspective(700px) rotateX(${(-ny * TILT_DEGREES).toFixed(2)}deg) rotateY(${(
			nx * TILT_DEGREES
		).toFixed(2)}deg) translateZ(${-PRESS_DEPTH}px)`;
	};

	let shrinkTimeoutId = null;
	const resetLinks = () => {
		document.querySelectorAll(".underline a").forEach((link) => {
			const wrapper = link.closest(".underline");
			if (!wrapper) return;
			const originalHTML = link.dataset.originalHtml;
			if (originalHTML) link.innerHTML = originalHTML;
			link.classList.remove("is-active", "is-post-click");
			link.style.transform = "";
			wrapper.classList.remove("is-hovered");
		});
	};

	wrappers.forEach((wrapper) => {
		const link = wrapper.querySelector("a");
		if (!link) return;

		link.dataset.originalHtml = link.innerHTML;

		const clearWrapperStates = () => {
			wrapper.classList.remove("is-hovered");
		};

		const recoil = () => {
			link.classList.remove("is-active");
			link.classList.add("is-post-click");
			link.style.transform = "";
		};

		wrapper.classList.remove("is-hovered");
		link.classList.remove("is-active", "is-post-click");

		wrapper.addEventListener("pointerenter", (e) => {
			if (isPenPointer(e)) return;
			wrapper.classList.add("is-hovered");
		});
		wrapper.addEventListener("pointerleave", (e) => {
			if (isPenPointer(e)) return;
			clearWrapperStates();
			if (TILT_ENABLED) {
				if (link.classList.contains("is-active")) recoil();
			} else {
				link.classList.remove("is-active");
			}
		});

		link.addEventListener("pointerdown", (e) => {
			if (isPenPointer(e)) return;
			link.classList.remove("is-post-click");
			link.classList.add("is-active");
			if (!TILT_ENABLED || reduceMotion.matches) return;
			link.style.transform = pressTransform(link, e);
		});

		// A touch that turns into a scroll cancels the pointer instead of firing
		// pointerup, so release the press state here or it stays stuck.
		link.addEventListener("pointercancel", (e) => {
			if (isPenPointer(e)) return;
			clearWrapperStates();
			recoil();
		});

		link.addEventListener("pointerup", (e) => {
			if (isPenPointer(e)) return;
			// Every press must release, including clicks that open another tab.
			recoil();
		});

		// preventDefault() on pointerup does not cancel the browser's own
		// navigation — only the click event's default action does that, so the
		// redirect delay has to live here, not in the pointerup handler above.
		link.addEventListener("click", (e) => {
			if (isPenPointer(e)) {
				e.preventDefault();
				return;
			}
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			e.preventDefault();

			const href = link.href;
			setTimeout(() => {
				link.innerHTML = "Taking you there...";
			}, 75);

			setTimeout(() => {
				link.innerHTML = link.dataset.originalHtml || link.innerHTML;
				window.location.href = href;
			}, 500);
		});
	});

	window.addEventListener("pageshow", (event) => {
		if (event.persisted) {
			resetLinks();
		}
	});
});
