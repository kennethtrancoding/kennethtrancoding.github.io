document.addEventListener("DOMContentLoaded", () => {
	let autoSpan = "";

	for (let letter of $("#title").text().split("")) {
		autoSpan += `<span class="title-letter" data-original="${letter}">${letter}</span>`;
	}
	$("#title").html(autoSpan);

	const letters = $("#title").children();

	function mouseOverEffect(selection) {
		const index = selection.index();

		letters.removeClass("is-main is-neighbor");
		selection.addClass("is-main");

		if (index + 1 < letters.length) {
			letters.eq(index + 1).addClass("is-neighbor");
		}
		if (index - 1 >= 0) {
			letters.eq(index - 1).addClass("is-neighbor");
		}
	}

	$("#title > *").on("mouseover", function () {
		mouseOverEffect($(this));
	});

	$("#title").on("mouseout", function () {
		letters.removeClass("is-main is-neighbor");
	});
	////////////////////////////////

	const wrappers = document.querySelectorAll(".underline");
	if (!wrappers.length) return;

	let shrinkTimeoutId = null;
	const resetLinks = () => {
		document.querySelectorAll(".underline [data-ref]").forEach((link) => {
			const wrapper = link.closest(".underline");
			if (!wrapper) return;
			const originalHTML = link.dataset.originalHtml;
			if (originalHTML) link.innerHTML = originalHTML;
			link.classList.remove("is-active", "is-post-click");
			wrapper.classList.remove("is-hovered");
		});
	};

	wrappers.forEach((wrapper) => {
		const link = wrapper.querySelector("[data-ref]");
		if (!link) return;

		link.dataset.originalHtml = link.innerHTML;

		const clearWrapperStates = () => {
			wrapper.classList.remove("is-hovered");
		};

		wrapper.classList.remove("is-hovered");
		link.classList.remove("is-active", "is-post-click");

		wrapper.addEventListener("pointerenter", () => {
			wrapper.classList.add("is-hovered");
		});
		wrapper.addEventListener("pointerleave", () => {
			clearWrapperStates();
			link.classList.remove("is-active");
		});

		link.addEventListener("pointerdown", () => {
			link.classList.add("is-active");
			link.classList.remove("is-post-click");
		});

		link.addEventListener("pointerup", (e) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

			e.preventDefault();
			link.classList.remove("is-active");
			link.classList.add("is-post-click");

			const href = link.dataset.ref;
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
