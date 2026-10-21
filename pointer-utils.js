// Apple Pencil is explicitly not a pointing device on this page. Pen input
// never hovers, presses, or follows a link — the title hover, project link,
// and ink layer scripts all swallow it using these two predicates, the single
// definition of "that was the Pencil": pointer events label it pointerType
// "pen", and iOS touch events label it touchType "stylus".
const isPenPointer = (event) => event.pointerType === "pen";
const isStylusTouch = (touch) => !!touch && touch.touchType === "stylus";
