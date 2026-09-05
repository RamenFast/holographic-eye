// Zig owns only the Field's packed f64 hit-test loop. GPLv3.
const std = @import("std");

pub const fact_capacity: u32 = 131_072;
const coordinate_capacity: usize = @as(usize, fact_capacity) * 2;

var facts: [coordinate_capacity]f64 align(8) = [_]f64{0} ** coordinate_capacity;

pub export fn facts_ptr() u32 {
    return @truncate(@intFromPtr(&facts));
}

pub export fn facts_capacity() u32 {
    return fact_capacity;
}

pub export fn hit_test(
    count: u32,
    cx: f64,
    cy: f64,
    scale: f64,
    width: f64,
    height: f64,
    sx: f64,
    sy: f64,
) i32 {
    @setFloatMode(.strict);
    if (count > fact_capacity) return -1;
    return hitTest(facts[0 .. @as(usize, count) * 2], cx, cy, scale, width, height, sx, sy);
}

fn hitTest(
    coordinates: []const f64,
    cx: f64,
    cy: f64,
    scale: f64,
    width: f64,
    height: f64,
    sx: f64,
    sy: f64,
) i32 {
    @setFloatMode(.strict);
    var best: i32 = -1;
    var best_d: f64 = 100.0;
    var row: usize = 0;
    while (row * 2 + 1 < coordinates.len) : (row += 1) {
        const x = coordinates[row * 2];
        const y = coordinates[row * 2 + 1];
        const px = (x - cx) * scale + width / 2.0;
        const py = (y - cy) * scale + height / 2.0;
        const dx = px - sx;
        const dy = py - sy;
        const d = dx * dx + dy * dy;
        if (d < best_d) {
            best_d = d;
            best = @intCast(row);
        }
    }
    return best;
}

fn expectHit(coordinates: []const f64, expected: i32, sx: f64, sy: f64) !void {
    try std.testing.expectEqual(expected, hitTest(coordinates, 0, 0, 1, 100, 100, sx, sy));
}

test "empty input misses" {
    try expectHit(&.{}, -1, 50, 50);
}

test "inside radius hits and exact boundary misses" {
    try expectHit(&.{ 0, 0 }, 0, 59.999, 50);
    try expectHit(&.{ 0, 0 }, -1, 60, 50);
}

test "first packed row wins an equal-distance tie" {
    try expectHit(&.{ -1, 0, 1, 0 }, 0, 50, 50);
}

test "strictly nearer row replaces the first" {
    try expectHit(&.{ -2, 0, 1, 0 }, 1, 50, 50);
}

test "NaN and infinity never win" {
    try expectHit(&.{ std.math.nan(f64), 0, std.math.inf(f64), 0, 2, 3 }, 2, 52, 53);
    try expectHit(&.{ std.math.nan(f64), 0, std.math.inf(f64), 0 }, -1, 50, 50);
}

test "null y coercion value zero behaves as a normal coordinate" {
    try expectHit(&.{ 2, 0 }, 0, 52, 50);
}

test "export rejects a count beyond the fixed capacity" {
    try std.testing.expectEqual(@as(i32, -1), hit_test(fact_capacity + 1, 0, 0, 1, 100, 100, 50, 50));
}
