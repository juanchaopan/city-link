import type { EventSystem, ICanvas } from 'pixi.js';

type PointerHandler = (event: PointerEvent) => void;

interface PointerEntryPoints {
  _onPointerDown: PointerHandler;
  _onPointerMove: PointerHandler;
  _onPointerUp: PointerHandler;
}

function toPointerEvent(
  touch: WechatMinigame.Touch,
  type: string,
  primary: boolean,
  target: ICanvas,
) {
  return {
    type,
    pointerId: touch.identifier,
    pointerType: 'touch',
    isPrimary: primary,
    clientX: touch.clientX,
    clientY: touch.clientY,
    pageX: touch.clientX,
    pageY: touch.clientY,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    width: 1,
    height: 1,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    tangentialPressure: 0,
    movementX: 0,
    movementY: 0,
    composedPath: () => [],
    preventDefault: () => undefined,
    target,
    cancelable: false,
  } as unknown as PointerEvent;
}

/** 把微信触摸事件转成 Pixi 事件系统能识别的指针事件。 */
export function connectTouches(events: EventSystem, target: ICanvas): void {
  const entry = events as unknown as PointerEntryPoints;
  const forward =
    (type: string, handler: PointerHandler) =>
    (event: WechatMinigame.OnTouchStartListenerResult) => {
      for (const touch of event.changedTouches) {
        handler.call(events, toPointerEvent(touch, type, event.touches.length <= 1, target));
      }
    };

  wx.onTouchStart(forward('pointerdown', entry._onPointerDown));
  wx.onTouchMove(forward('pointermove', entry._onPointerMove));
  wx.onTouchEnd(forward('pointerup', entry._onPointerUp));
  wx.onTouchCancel(forward('pointerup', entry._onPointerUp));
}
