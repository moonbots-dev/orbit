import type { OrbitError } from './errors.js';
import type { Clock } from './clock.js';
import type { Subscription } from './events.js';
export type { OrbitError, Clock, Subscription };

/** Readonly entry point; contains no implicit current-device singleton. */
export interface Orbit {
  connect(options: ConnectOptions): Promise<Puck>;
  discover(options: DiscoverOptions): Promise<readonly DeviceInfo[]>;
}

export interface HostOptions {
  readonly endpoint: string;
  /** Invoked explicitly during connection; never included in diagnostics. */
  readonly credentials?: () => Promise<string>;
}

export interface OperationOptions {
  readonly signal?: AbortSignal;
  /** Positive operation deadline in milliseconds; default 5000. */
  readonly timeoutMs?: number;
}

export interface ConnectOptions extends OperationOptions {
  /** 'simulator' creates an isolated virtual target; host targets select an ID. */
  readonly target:
    | 'simulator'
    | 'runtime'
    | DeviceAdapter
    | {
        readonly host: HostOptions;
        readonly deviceId: string;
      };
  /** Default []: observe only. ['screen'] requests exclusive screen control. */
  readonly control?: readonly 'screen'[];
  readonly clock?: Clock;
  /** Default true for real time, false for a manual clock. */
  readonly keepAlive?: boolean;
}

export interface DiscoverOptions extends OperationOptions {
  readonly host: HostOptions;
}

export interface DeviceInfo {
  readonly id: string;
  readonly model: string;
  readonly source: 'simulated' | 'physical' | 'replay';
  readonly bootId: string;
  readonly protocolVersion: string;
  readonly firmwareVersion: string | null;
}

/** A connected logical device, independent of its simulator or host transport. */
export interface Puck {
  readonly info: DeviceInfo;
  readonly screen: Screen;
  readonly touch: Touch;
  readonly capabilities: Capabilities;
  readonly imu: Imu;
  readonly buttons: Buttons;
  readonly switches: Switches;
  readonly inputs: Inputs;
  readonly diagnostics: { snapshot(): Diagnostics };
  readonly clock: Clock;
  readonly status: 'connected' | 'closing' | 'closed';
  /** Resolves on explicit close; rejects on terminal connection failure. */
  readonly closed: Promise<void>;
  on<K extends keyof SessionEvents>(
    event: K,
    handler: (event: SessionEvents[K]) => void,
  ): Subscription;
  /** Idempotent. Cancels owned callbacks/subscriptions and releases control. */
  close(): Promise<void>;
}

export interface SessionEvents {
  readonly error: OrbitError;
  readonly disconnect: {
    readonly reason: 'closed' | 'connection-lost' | 'device-restarted';
    readonly hostTimeMs: number;
  };
}

export interface Point {
  /** Logical screen units, increasing toward the right. */
  readonly x: number;
  /** Logical screen units, increasing downward. */
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Runtime validation accepts #RRGGBB and #RRGGBBAA, not arbitrary CSS. */
export type Color = `#${string}`;

export interface Stroke {
  readonly color: Color;
  /** Width in logical screen units; positive. */
  readonly width: number;
}

/** At least one of fill/stroke is required. Both compose fill then stroke. */
export type Paint =
  | { readonly fill: Color; readonly stroke?: Stroke }
  | { readonly fill?: Color; readonly stroke: Stroke };

export type CircleOptions = Paint & {
  readonly center: Point;
  readonly radius: number;
};

export type EllipseOptions = Paint & {
  readonly center: Point;
  readonly radiusX: number;
  readonly radiusY: number;
};

export type RectOptions = Paint & {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cornerRadius?: number;
};

export type PathSegment =
  | { readonly type: 'move'; readonly to: Point }
  | { readonly type: 'line'; readonly to: Point }
  | { readonly type: 'quadratic'; readonly control: Point; readonly to: Point }
  | {
      readonly type: 'cubic';
      readonly control1: Point;
      readonly control2: Point;
      readonly to: Point;
    }
  | { readonly type: 'close' };

export interface PathGeometry {
  readonly segments: readonly PathSegment[];
  readonly fillRule?: 'nonzero' | 'evenodd';
}

declare const assetBrand: unique symbol;
/** Produced by the proposed explicit image decoder, not a network URL. */
export interface ImageAsset {
  readonly [assetBrand]: 'image';
  readonly id: string;
  readonly size: Size;
}
/** Produced by the proposed explicit font decoder, not an OS font family name. */
export interface FontAsset {
  readonly [assetBrand]: 'font';
  readonly id: string;
}

export interface TextOptions {
  readonly text: string;
  readonly at: Point;
  readonly font: FontAsset;
  readonly size: number;
  readonly fill: Color;
  /** at.y is the baseline; alignment applies horizontally. */
  readonly align?: 'left' | 'center' | 'right';
}

export interface ImageOptions {
  readonly image: ImageAsset;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly opacity?: number;
}

export interface PixelsOptions {
  /** Copied while recording the call; caller mutations cannot change the frame. */
  readonly data: Uint8Array;
  readonly format: 'rgba8888' | 'rgb565-le';
  /** Integer source pixel dimensions; maps 1:1 into logical units. */
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

/**
 * A local drawing surface for ONE complete frame. Methods do not send packets.
 * Never retain this object beyond its callback. Transform stack must balance.
 * Unsupported operations reject validation rather than being approximated.
 */
export interface Frame {
  readonly size: Size;
  readonly center: Point;
  /** Set the whole-frame background once, before primitives; required. */
  clear(color: Color): void;
  circle(options: CircleOptions): void;
  ellipse(options: EllipseOptions): void;
  rect(options: RectOptions): void;
  line(options: {
    readonly from: Point;
    readonly to: Point;
    readonly stroke: Stroke;
  }): void;
  path(options: PathGeometry & Paint): void;
  text(options: TextOptions): void;
  image(options: ImageOptions): void;
  pixels(options: PixelsOptions): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  scale(x: number, y: number): void;
  /** 0–1; affects subsequent primitives. */
  setOpacity(value: number): void;
  clip(path: PathGeometry): void;
}

/** Versioned, portable drawing data. Validated before presentation. */
export interface Scene {
  readonly version: 1;
  readonly size: Size;
  readonly background: Color;
  readonly commands: readonly DrawCommand[];
}
export type DrawCommand =
  | { readonly op: 'circle'; readonly value: CircleOptions }
  | { readonly op: 'ellipse'; readonly value: EllipseOptions }
  | { readonly op: 'rect'; readonly value: RectOptions }
  | {
      readonly op: 'line';
      readonly value: {
        readonly from: Point;
        readonly to: Point;
        readonly stroke: Stroke;
      };
    }
  | { readonly op: 'path'; readonly value: PathGeometry & Paint }
  | {
      readonly op: 'pixels';
      readonly value: Omit<PixelsOptions, 'data'> & {
        readonly data: readonly number[];
      };
    }
  | { readonly op: 'save' | 'restore' }
  | {
      readonly op: 'translate' | 'scale';
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: 'rotate' | 'opacity'; readonly value: number }
  | { readonly op: 'clip'; readonly value: PathGeometry };

/** Manual builders are finalized by the author; callback frames are finalized by SDK. */
export interface FrameBuilder extends Frame {
  build(): Scene;
}

export interface Timing {
  /** Active milliseconds since this animation began; excludes pauses; first is 0. */
  readonly elapsedMs: number;
  /** Active milliseconds since the previous callback; first and first after resume are 0. */
  readonly deltaMs: number;
  /** Zero-based callback count, not a count of frames physically displayed. */
  readonly frameIndex: number;
}

export type DrawCallback = (frame: Frame) => void;
export type AnimationCallback = (frame: Frame, timing: Timing) => void;

export type Acknowledgement = 'accepted' | 'applied' | 'presentation-submitted';

export interface FrameOptions extends OperationOptions {
  /** Default latest: one in-flight plus one replaceable pending frame. FIFO is bounded. */
  readonly queue?: 'latest' | 'fifo';
  /** Default accepted; unsupported levels reject. No level proves pixel visibility. */
  readonly acknowledgement?: Acknowledgement;
}

export type FrameResult =
  | { readonly status: 'superseded'; readonly frameId: number }
  | {
      readonly status: 'acknowledged';
      readonly frameId: number;
      readonly acknowledgement: Acknowledgement;
      readonly hostTimeMs: number;
      readonly deviceTimeUs?: number;
    };

export interface AnimationOptions extends FrameOptions {
  /** Desired host callback rate; default 60; actual output rate depends on target. */
  readonly fps?: number;
}

export interface Animation {
  readonly state: 'running' | 'paused' | 'stopped';
  /** Resolves when stopped/closed; rejects on rendering failure or abort. */
  readonly finished: Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  onError(handler: (error: OrbitError) => void): Subscription;
}

export interface Screen {
  readonly size: Size;
  readonly center: Point;
  readonly capabilities: {
    readonly shape: 'circle' | 'rectangle';
    readonly physicalSize: Size;
    readonly operations: readonly (
      | 'circle'
      | 'ellipse'
      | 'rect'
      | 'line'
      | 'path'
      | 'text'
      | 'image'
      | 'pixels'
      | 'transform'
      | 'clip'
      | 'opacity'
    )[];
    readonly maxFrameBytes: number;
    readonly maxPrimitives: number;
    readonly maxPathSegments: number;
    readonly maxQueuedFrames: number;
    readonly acknowledgements: readonly Acknowledgement[];
  };
  on(event: 'frame', handler: (event: ScreenEvent) => void): Subscription;
  contains(point: Point): boolean;
  /** Invokes draw synchronously, validates, then asynchronously submits the result. */
  draw(draw: DrawCallback, options?: FrameOptions): Promise<FrameResult>;
  /** First callback is deferred, so callers can install error/shutdown handlers. */
  animate(draw: AnimationCallback, options?: AnimationOptions): Animation;
  createFrame(): FrameBuilder;
  present(scene: Scene, options?: FrameOptions): Promise<FrameResult>;
}

export interface ObservationMetadata {
  readonly sequence: number;
  readonly bootId: string;
  /** Source-device microseconds; not comparable across boot IDs. */
  readonly deviceTimeUs: number;
  /** Monotonic host receipt time; not the source-device clock. */
  readonly receivedTimeMs: number;
  readonly source: 'physical' | 'simulated' | 'replay';
}

export interface ContactEvent<
  Phase extends 'down' | 'move' | 'up',
> extends ObservationMetadata {
  readonly type: 'touch';
  readonly phase: Phase;
  readonly contactId: number;
  readonly position: Point;
}

export interface CancelEvent extends ObservationMetadata {
  readonly type: 'touch';
  readonly phase: 'cancel';
  readonly contactId: number;
  readonly position?: Point;
  readonly reason: 'disconnected' | 'input-gap' | 'device-cancelled';
}

export interface TouchEvents {
  readonly down: ContactEvent<'down'>;
  readonly move: ContactEvent<'move'>;
  readonly up: ContactEvent<'up'>;
  readonly cancel: CancelEvent;
}

export type TouchEvent = TouchEvents[keyof TouchEvents];

export interface Touch {
  readonly capabilities: { readonly maxContacts: number };
  readonly contacts: readonly {
    readonly contactId: number;
    readonly position: Point;
  }[];
  /** Event name selects the exact payload type in autocomplete. */
  on<K extends keyof TouchEvents>(
    event: K,
    handler: (event: TouchEvents[K]) => void,
  ): Subscription;
}

export interface ImuSample extends ObservationMetadata {
  readonly type: 'imu';
  /** Device axes as advertised; m/s² and rad/s respectively. */
  readonly acceleration: readonly [number, number, number];
  readonly angularVelocity: readonly [number, number, number];
}
export interface ButtonEvent extends ObservationMetadata {
  readonly type: 'button';
  readonly id: string;
  readonly phase: 'down' | 'up' | 'cancel';
}
export interface SwitchEvent extends ObservationMetadata {
  readonly type: 'switch';
  readonly id: string;
  readonly value: boolean;
}
export interface Discontinuity extends ObservationMetadata {
  readonly type: 'discontinuity';
  readonly reason: 'input-gap' | 'disconnected' | 'reset';
}
export type InputEvent =
  | TouchEvent
  | ImuSample
  | ButtonEvent
  | SwitchEvent
  | Discontinuity;
export type InputKind = InputEvent['type'];
export interface Imu {
  readonly latest: ImuSample | undefined;
  on(event: 'sample', handler: (event: ImuSample) => void): Subscription;
}
export interface Buttons {
  readonly ids: readonly string[];
  get(id: string): ButtonEvent | undefined;
  on(
    phase: ButtonEvent['phase'],
    handler: (event: ButtonEvent) => void,
  ): Subscription;
}
export interface Switches {
  readonly ids: readonly string[];
  get(id: string): SwitchEvent | undefined;
  on(event: 'change', handler: (event: SwitchEvent) => void): Subscription;
}
export interface Inputs {
  on(handler: (event: InputEvent) => void): Subscription;
  stream(options?: {
    kinds?: readonly InputKind[];
    signal?: AbortSignal;
    buffer?: number;
  }): AsyncIterable<InputEvent>;
}
export interface ScreenEvent {
  readonly scene: Scene;
  readonly frameId: number;
  readonly hostTimeMs: number;
}
export interface Capabilities {
  readonly profile: string;
  readonly screen: Screen['capabilities'];
  readonly viewport: Size;
  readonly touch: Touch['capabilities'];
  readonly imu: {
    readonly present: boolean;
    readonly accelerationUnit: 'm/s²';
    readonly angularVelocityUnit: 'rad/s';
    readonly axes: string;
  };
  readonly buttons: readonly string[];
  readonly switches: readonly string[];
  readonly audio: false;
  readonly hid: false;
  readonly physicalTransport: boolean;
}
export interface Diagnostics {
  readonly receivedInputs: number;
  readonly inputGaps: number;
  readonly submittedFrames: number;
  readonly acknowledgedFrames: number;
  readonly supersededFrames: number;
  readonly pendingFrames: number;
  readonly screenControl: boolean;
}
/** Transport implementations provide the same bounded logical session contract. */
export interface DeviceAdapter {
  readonly kind: 'orbit-adapter';
  open(options: {
    control: readonly 'screen'[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<AdapterSession>;
}
export interface AdapterSession {
  readonly info: DeviceInfo;
  readonly capabilities: Capabilities;
  readonly clock: Clock;
  onInput(handler: (event: InputEvent) => void): Subscription;
  onFrame(handler: (event: ScreenEvent) => void): Subscription;
  onDisconnect(handler: (reason: string) => void): Subscription;
  present(
    scene: Scene,
    frameId: number,
    options?: FrameOptions,
  ): Promise<FrameResult>;
  close(): Promise<void>;
}
