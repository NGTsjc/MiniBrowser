//! Geometry shared by the control renderer and native hit region, in physical pixels.
use crate::parameters as p;
use serde::Serialize;
use std::f64::consts::{FRAC_PI_4, PI};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DragShape {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub arc: bool,
    pub points: Vec<[i32; 2]>,
    pub grip: [i32; 2],
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
            x: 0,
            y: 0,
            width: (p::DRAG_SIZE * scale).round() as u32,
            height: (p::DRAG_SIZE * scale).round() as u32,
            arc: false,
            points: vec![],
            grip: [grip, grip],
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
        x,
        y,
        width,
        height,
        arc: true,
        points,
        grip: [(center.round() as i32 - x), (center.round() as i32 - y)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inside(x: f64, y: f64, w: f64, h: f64, r: f64) -> bool {
        let dx = (r - x.min(w - x)).max(0.);
        let dy = (r - y.min(h - y)).max(0.);
        x >= 0. && y >= 0. && x <= w && y <= h && dx * dx + dy * dy <= r * r + 1.
    }
    #[test]
    fn drag_interaction_and_panel_follow_all_supported_shapes_and_dpis() {
        for scale in [1., 1.25, 1.5, 2., 3.] {
            for (width, height) in [(280., 200.), (960., 600.)] {
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
