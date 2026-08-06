export type SeatingPattern =
  | 'sequential'
  | 'alternate_seat'
  | 'rowwise_mixed'
  | 'columnwise_mixed'
  | 'checkerboard'
  | 'snake_order';

export interface SeatingStudentInput {
  id: number;
  department_id: number;
}

export interface SeatAssignment {
  student_id: number;
  seat_number: string;
}

const COLS = 6;

/** Same fixed 6-column grid as generateSeatPlan, for manual-mode allocation (no pattern involved). */
export function seatLabelForIndex(index: number, cols = COLS): string {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return `${rowLabelFor(row)}${col + 1}`;
}

function rowLabelFor(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** Row-major grid positions: fill row 0 left-to-right, then row 1, etc. */
function rowMajorPositions(rows: number, cols: number): [number, number][] {
  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) positions.push([r, c]);
  }
  return positions;
}

/** Column-major grid positions: fill column 0 top-to-bottom, then column 1, etc. */
function columnMajorPositions(rows: number, cols: number): [number, number][] {
  const positions: [number, number][] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) positions.push([r, c]);
  }
  return positions;
}

/** Boustrophedon: row 0 left-to-right, row 1 right-to-left, row 2 left-to-right... */
function snakePositions(rows: number, cols: number): [number, number][] {
  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const cols_ =
      r % 2 === 0 ? [...Array(cols).keys()] : [...Array(cols).keys()].reverse();
    for (const c of cols_) positions.push([r, c]);
  }
  return positions;
}

/** [0,2,4,...,1,3,5...] within a row-major grid — leaves maximum spacing between consecutively-filled seats. */
function alternateSeatPositions(
  rows: number,
  cols: number,
): [number, number][] {
  const positions: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c += 2) positions.push([r, c]);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c < cols; c += 2) positions.push([r, c]);
  }
  return positions;
}

/** Round-robin merge across department groups, preserving each group's internal order. */
function interleaveByDepartment(
  students: SeatingStudentInput[],
): SeatingStudentInput[] {
  const groups = new Map<number, SeatingStudentInput[]>();
  for (const s of students) {
    const group = groups.get(s.department_id) ?? [];
    group.push(s);
    groups.set(s.department_id, group);
  }
  const queues = [...groups.values()];
  const merged: SeatingStudentInput[] = [];
  let remaining = students.length;
  while (remaining > 0) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        merged.push(next);
        remaining--;
      }
    }
  }
  return merged;
}

/**
 * Assigns seat labels to students under one of 6 patterns, all operating
 * over the same fixed 6-column grid (venues have no rows/cols field, so a
 * uniform column count keeps every pattern comparable). Patterns differ in
 * either grid traversal order, student ordering (interleaved by
 * department), or both — there's no single canonical algorithm for these
 * names, this is a reasonable, consistent interpretation of each.
 */
export function generateSeatPlan(
  pattern: SeatingPattern,
  students: SeatingStudentInput[],
  capacity: number,
): SeatAssignment[] {
  const capped = students.slice(0, capacity);
  const rows = Math.max(1, Math.ceil(capped.length / COLS));

  let positions: [number, number][];
  let order: SeatingStudentInput[];

  switch (pattern) {
    case 'sequential':
      positions = rowMajorPositions(rows, COLS);
      order = capped;
      break;
    case 'snake_order':
      positions = snakePositions(rows, COLS);
      order = capped;
      break;
    case 'alternate_seat':
      positions = alternateSeatPositions(rows, COLS);
      order = capped;
      break;
    case 'rowwise_mixed':
      positions = rowMajorPositions(rows, COLS);
      order = interleaveByDepartment(capped);
      break;
    case 'columnwise_mixed':
      positions = columnMajorPositions(rows, COLS);
      order = interleaveByDepartment(capped);
      break;
    case 'checkerboard': {
      positions = rowMajorPositions(rows, COLS);
      // Two pools by parity of (row+col) at each position, filled from two
      // interleaved-by-department queues so adjacent seats differ in dept.
      const merged = interleaveByDepartment(capped);
      const evens = merged.filter((_, i) => i % 2 === 0);
      const odds = merged.filter((_, i) => i % 2 === 1);
      let evenIdx = 0;
      let oddIdx = 0;
      order = positions.map(([r, c]) => {
        const useEven = (r + c) % 2 === 0;
        if (useEven && evenIdx < evens.length) return evens[evenIdx++];
        if (!useEven && oddIdx < odds.length) return odds[oddIdx++];
        return evenIdx < evens.length ? evens[evenIdx++] : odds[oddIdx++];
      });
      break;
    }
  }

  return positions.slice(0, order.length).map(([r, c], i) => ({
    student_id: order[i].id,
    seat_number: `${rowLabelFor(r)}${c + 1}`,
  }));
}
