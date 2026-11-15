import { describe, expect, it } from 'vitest';
import { isArrowKey, nextNode, tabStop } from './graphNav';

/*
 *        4
 *   2 .  1  . 3      6 (far right, slightly up)
 *        5
 *              7 (close, but mostly below: down-right at a steep angle)
 */
const nodes = [
  { id: 1, x: 0, y: 0 },
  { id: 2, x: -10, y: 0 },
  { id: 3, x: 10, y: 0 },
  { id: 4, x: 0, y: -10 },
  { id: 5, x: 0, y: 10 },
  { id: 6, x: 40, y: -5 },
  { id: 7, x: 4, y: 9 },
];

describe('nextNode', () => {
  it('moves to the nearest node in the direction pressed', () => {
    expect(nextNode(nodes, 1, 'ArrowRight')).toBe(3);
    expect(nextNode(nodes, 1, 'ArrowLeft')).toBe(2);
    expect(nextNode(nodes, 1, 'ArrowUp')).toBe(4);
    expect(nextNode(nodes, 3, 'ArrowRight')).toBe(6);
  });

  it('leaves a node that is more across than along to the other arrows', () => {
    // 7 is 4 right and 9 down of 1, nearer than 3 by plain distance (9.8
    // against 10). It is not what Right means, and Down has 5 dead ahead.
    expect(nextNode(nodes, 1, 'ArrowRight')).toBe(3);
    expect(nextNode(nodes, 1, 'ArrowDown')).toBe(5);
    // From 5 it is 4 right and 1 up: Right.
    expect(nextNode(nodes, 5, 'ArrowRight')).toBe(7);
  });

  it('prefers straight ahead over nearer but off to the side', () => {
    const three = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 6, y: 3 },
    ];
    // 3 is nearer (6.7 against 10) and inside the cone, but costs 6 + 2x3 = 12
    // against 10. Counting the sideways distance once would make it 9, and win.
    expect(nextNode(three, 1, 'ArrowRight')).toBe(2);
  });

  it('keeps to the cone even when something outside it would cost less', () => {
    const three = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 20, y: 0 },
      { id: 3, x: 3, y: 4 },
    ];
    // 3 costs 3 + 2x4 = 11 against 2's 20, but it is more down than right.
    expect(nextNode(three, 1, 'ArrowRight')).toBe(2);
    expect(nextNode(three, 1, 'ArrowDown')).toBe(3);
  });

  it('reaches a node outside the cone when nothing is inside it', () => {
    const two = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 2, y: 30 },
    ];
    expect(nextNode(two, 1, 'ArrowRight')).toBe(2);
  });

  it('stops at the edge, and for a node that is not there', () => {
    expect(nextNode(nodes, 6, 'ArrowRight')).toBeNull();
    expect(nextNode(nodes, 4, 'ArrowUp')).toBeNull();
    expect(nextNode(nodes, 99, 'ArrowLeft')).toBeNull();
  });
});

describe('tabStop', () => {
  const drawn = [{ id: 5 }, { id: 6 }, { id: 7 }];

  it('is the node last focused, then the selected one, then the first', () => {
    expect(tabStop(drawn, 6, 7)).toBe(6);
    expect(tabStop(drawn, null, 7)).toBe(7);
    expect(tabStop(drawn, null, null)).toBe(5);
  });

  it('skips a node the filter has removed', () => {
    expect(tabStop(drawn, 99, 7)).toBe(7);
    expect(tabStop(drawn, 99, 98)).toBe(5);
    expect(tabStop([], 6, 7)).toBeNull();
  });
});

describe('isArrowKey', () => {
  it('knows the four arrows and nothing else', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].every(isArrowKey)).toBe(true);
    expect(isArrowKey('Enter')).toBe(false);
    // Inherited names are not keys.
    expect(isArrowKey('toString')).toBe(false);
  });
});
