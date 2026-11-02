//! Geometry shared by the control renderer and native hit region, in physical pixels.
use crate::parameters as p;
use serde::{Deserialize, Serialize};
use std::f64::consts::{FRAC_PI_4, PI};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DragPosition {
    #[default]
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}
impl DragPosition {
    pub const ALL: [Self; 4] = [
        Self::TopLeft,
        Self::TopRight,
        Self::BottomLeft,
        Self::BottomRight,
    ];
    fn flips(self) -> (bool, bool) {
        (
            matches!(self, Self::TopRight | Self::BottomRight),
            matches!(self, Self::BottomLeft | Self::BottomRight),
        )
    }
}

#[derive(Default)]
pub struct Cache {
    base: Option<(i32, u64, Arc<DragShape>)>,
    placed: Option<(i32, i32, DragPosition, Arc<DragShape>)>,
}
impl Cache {
    pub fn get(&mut self, radius: i32, scale: f64) -> Arc<DragShape> {
        if let Some((r, s, shape)) = &self.base {
            if *r == radius && *s == scale.to_bits() {
                return shape.clone();
            }
        }
        let shape = Arc::new(drag_shape(radius, scale));
        self.base = Some((radius, scale.to_bits(), shape.clone()));
        self.placed = None;
        shape
    }
    pub fn place(
        &mut self,
        radius: i32,
        scale: f64,
        width: i32,
        height: i32,
        position: DragPosition,
    ) -> Arc<DragShape> {
        let base = self.get(radius, scale);
        if position == DragPosition::TopLeft {
            return base;
        }
        let (flip_x, flip_y) = position.flips();
        let key_width = if flip_x { width } else { 0 };
        let key_height = if flip_y { height } else { 0 };
        if let Some((w, h, p, shape)) = &self.placed {
            if (*w, *h, *p) == (key_width, key_height, position) {
                return shape.clone();
            }
        }
        let mut shape = base.as_ref().clone();
        shape.position = position;
        if flip_x {
            shape.x = width - base.x - base.width as i32;
            shape.grip[0] = shape.width as i32 - 1 - shape.grip[0];
            for point in &mut shape.points {
                point[0] = shape.width as i32 - 1 - point[0];
            }
        }
        if flip_y {
            shape.y = height - base.y - base.height as i32;
            shape.grip[1] = shape.height as i32 - 1 - shape.grip[1];
            for point in &mut shape.points {
                point[1] = shape.height as i32 - 1 - point[1];
            }
        }
        let shape = Arc::new(shape);
        self.placed = Some((key_width, key_height, position, shape.clone()));
        shape
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DragShape {
    pub position: DragPosition,
    pub edge_offset: [i32; 2],
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub arc: bool,
    pub points: Vec<[i32; 2]>,
    pub grip: [i32; 2],
    pub panel_inset: u32,
}

pub fn effective_radius(requested: u32, width: i32, height: i32, scale: f64) -> i32 {
    ((requested as f64 * scale).round() as i32)
        .min(width / 2)
        .min(height / 2)
        .max(0)
}

pub fn panel_inset(radius: i32, scale: f64) -> u32 {
    // The rectangle inside these four diagonal intersections is wholly inside
    // the rounded window, including its smallest 280×200 form.
    (p::PANEL_PADDING * scale)
        .ceil()
        .max((radius as f64 * (1. - 1. / 2_f64.sqrt())).ceil() + 2.) as u32
}

pub fn drag_shape(radius: i32, scale: f64) -> DragShape {
    let r = radius as f64;
    if r / scale < p::ARC_THRESHOLD {
        // Keep the square flush at the origin; the main region clips its corner.
        let side = (p::DRAG_SIZE * scale).round() as u32;
        let tangent = r * (1. - 1. / 2_f64.sqrt());
        let grip = ((side as f64 + tangent) / 2.).round() as i32;
        return DragShape {
            position: DragPosition::TopLeft,
            edge_offset: [0, 0],
            x: 0,
            y: 0,
            width: (p::DRAG_SIZE * scale).round() as u32,
            height: (p::DRAG_SIZE * scale).round() as u32,
            arc: false,
            points: vec![],
            grip: [grip, grip],
            panel_inset: panel_inset(radius, scale),
        };
    }
    let half = p::ARC_THICKNESS * scale / 2.;
    let rho = r - p::ARC_INSET * scale - half;
    let angle = p::ARC_LENGTH * scale / (2. * rho);
    let start = PI + FRAC_PI_4 - angle;
    let end = PI + FRAC_PI_4 + angle;
    let mut points = Vec::new();
    let mut push = |x: f64, y: f64| points.push([x.round() as i32, y.round() as i32]);
    // Dense shared polygon: less than a physical pixel of approximation error.
    let steps = (p::ARC_LENGTH * scale).ceil() as usize;
    for i in 0..=steps {
        let a = start + (end - start) * i as f64 / steps as f64;
        push(r + (rho + half) * a.cos(), r + (rho + half) * a.sin());
    }
    for i in 0..=32 {
        let a = end + PI * i as f64 / 32.;
        push(
            r + rho * end.cos() + half * a.cos(),
            r + rho * end.sin() + half * a.sin(),
        );
    }
    for i in 0..=steps {
        let a = end - (end - start) * i as f64 / steps as f64;
        push(r + (rho - half) * a.cos(), r + (rho - half) * a.sin());
    }
    for i in 0..=32 {
        let a = start + PI + PI * i as f64 / 32.;
        push(
            r + rho * start.cos() + half * a.cos(),
            r + rho * start.sin() + half * a.sin(),
        );
    }
    let x = points.iter().map(|p| p[0]).min().unwrap();
    let y = points.iter().map(|p| p[1]).min().unwrap();
    let width = (points.iter().map(|p| p[0]).max().unwrap() - x + 1) as u32;
    let height = (points.iter().map(|p| p[1]).max().unwrap() - y + 1) as u32;
    for point in &mut points {
        point[0] -= x;
        point[1] -= y;
    }
    let center = r - rho / 2_f64.sqrt();
    DragShape {
        position: DragPosition::TopLeft,
        edge_offset: [x, y],
        x,
        y,
        width,
        height,
        arc: true,
        points,
        grip: [(center.round() as i32 - x), (center.round() as i32 - y)],
        panel_inset: panel_inset(radius, scale),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_corners_mirror_visible_geometry_and_follow_resize_without_changing_shape() {
        for scale in [1., 1.25, 1.5, 2., 3.] {
            for (width, height) in [(p::MIN_WIDTH, p::MIN_HEIGHT), (280., 200.), (960., 600.)] {
                let (w, h) = ((width * scale) as i32, (height * scale) as i32);
                for requested in [0, 32, 63, 64, 128, p::MAX_CORNER_RADIUS] {
                    let radius = effective_radius(requested, w, h, scale);
                    let base = drag_shape(radius, scale);
                    for position in DragPosition::ALL {
                        let mut cache = Cache::default();
                        let shape = cache.place(radius, scale, w, h, position);
                        let (right, bottom) = position.flips();
                        assert_eq!(
                            shape.x,
                            if right {
                                w - base.x - base.width as i32
                            } else {
                                base.x
                            }
                        );
                        assert_eq!(
                            shape.y,
                            if bottom {
                                h - base.y - base.height as i32
                            } else {
                                base.y
                            }
                        );
                        assert_eq!(
                            (shape.width, shape.height, shape.arc),
                            (base.width, base.height, base.arc)
                        );
                        assert!(inside(
                            (shape.x + shape.grip[0]) as f64,
                            (shape.y + shape.grip[1]) as f64,
                            w as f64,
                            h as f64,
                            radius as f64
                        ));
                        for point in &shape.points {
                            assert!(inside(
                                (shape.x + point[0]) as f64,
                                (shape.y + point[1]) as f64,
                                w as f64,
                                h as f64,
                                radius as f64
                            ));
                        }
                        assert!(Arc::ptr_eq(
                            &shape,
                            &cache.place(radius, scale, w, h, position)
                        ));
                        let resized = cache.place(radius, scale, w + 100, h + 60, position);
                        assert_eq!(resized.x - shape.x, if right { 100 } else { 0 });
                        assert_eq!(resized.y - shape.y, if bottom { 60 } else { 0 });
                        assert_eq!(resized.points, shape.points);
                    }
                }
            }
        }
    }
    #[test]
    fn geometry_is_reused_until_effective_radius_or_dpi_changes() {
        let mut cache = Cache::default();
        let first = cache.get(128, 1.5);
        for _ in 0..100 {
            assert!(Arc::ptr_eq(&first, &cache.get(128, 1.5)));
        }
        assert!(!Arc::ptr_eq(&first, &cache.get(100, 1.5)));
        assert!(!Arc::ptr_eq(&first, &cache.get(128, 2.)));
    }
    fn inside(x: f64, y: f64, w: f64, h: f64, r: f64) -> bool {
        let dx = (r - x.min(w - x)).max(0.);
        let dy = (r - y.min(h - y)).max(0.);
        x >= 0. && y >= 0. && x <= w && y <= h && dx * dx + dy * dy <= r * r + 1.
    }
    #[test]
    fn drag_interaction_and_panel_follow_all_supported_shapes_and_dpis() {
        for scale in [1., 1.25, 1.5, 2., 3.] {
            for (width, height) in [(p::MIN_WIDTH, p::MIN_HEIGHT), (280., 200.), (960., 600.)] {
                let w = (width * scale) as i32;
                let h = (height * scale) as i32;
                for requested in 0..=p::MAX_CORNER_RADIUS {
                    let r = effective_radius(requested, w, h, scale);
                    let shape = drag_shape(r, scale);
                    assert_eq!(shape.arc, r as f64 / scale >= p::ARC_THRESHOLD);
                    if !shape.arc {
                        assert_eq!(shape.width, shape.height);
                        assert_eq!((shape.x, shape.y), (0, 0));
                    }
                    let points = if shape.arc {
                        shape.points.clone()
                    } else {
                        vec![shape.grip, [shape.width as i32, shape.height as i32]]
                    };
                    for [x, y] in points {
                        assert!(inside(
                            (x + shape.x) as f64,
                            (y + shape.y) as f64,
                            w as f64,
                            h as f64,
                            r as f64
                        ));
                    }
                    let inset = panel_inset(r, scale) as f64;
                    assert!(inside(inset, inset, w as f64, h as f64, r as f64));
                    assert!(shape.width > 0 && shape.height > 0);
                }
            }
        }
        assert_eq!(effective_radius(128, 280, 200, 1.), 100);
        assert_eq!(effective_radius(128, 960, 600, 1.), 128);
        assert_eq!((drag_shape(0, 1.).x, drag_shape(0, 1.).y), (0, 0));
    }
}
