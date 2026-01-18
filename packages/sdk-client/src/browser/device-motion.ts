// Purpose: Typed helpers for device motion/orientation constructors.

type DeviceMotionRequestPermission = () => Promise<'granted' | 'denied' | string>;

type DeviceMotionCtor = {
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
  prototype: DeviceMotionEvent;
  requestPermission?: DeviceMotionRequestPermission;
};

type DeviceOrientationCtor = {
  new (type: string, eventInitDict?: DeviceOrientationEventInit): DeviceOrientationEvent;
  prototype: DeviceOrientationEvent;
  requestPermission?: DeviceMotionRequestPermission;
};

export const getDeviceMotionEventCtor = (win?: Window | null): DeviceMotionCtor | null => {
  if (!win) return null;
  const typed = win as Window & { DeviceMotionEvent?: DeviceMotionCtor };
  return typed.DeviceMotionEvent ?? null;
};

export const getDeviceOrientationEventCtor = (
  win?: Window | null
): DeviceOrientationCtor | null => {
  if (!win) return null;
  const typed = win as Window & { DeviceOrientationEvent?: DeviceOrientationCtor };
  return typed.DeviceOrientationEvent ?? null;
};
