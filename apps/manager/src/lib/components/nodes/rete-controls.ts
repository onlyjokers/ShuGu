import { ClassicPreset } from 'rete';

export type SelectOption = { value: string; label: string };

export class SelectControl extends ClassicPreset.Control {
  controlType = 'select' as const;
  label?: string;
  placeholder?: string;
  options: SelectOption[];
  value: string;
  readonly: boolean;
  private onChange?: (value: string) => void;

  constructor(opts: {
    label?: string;
    placeholder?: string;
    initial?: string;
    options?: SelectOption[];
    readonly?: boolean;
    change?: (value: string) => void;
  }) {
    super();
    this.label = opts.label;
    this.placeholder = opts.placeholder;
    this.options = opts.options ?? [];
    this.value = opts.initial ?? '';
    this.readonly = Boolean(opts.readonly);
    this.onChange = opts.change;
  }

  setOptions(options: SelectOption[]): void {
    this.options = options;
  }

  setValue(value: string): void {
    if (this.readonly) return;
    this.value = value;
    this.onChange?.(value);
  }
}

export class BooleanControl extends ClassicPreset.Control {
  controlType = 'boolean' as const;
  label?: string;
  value: boolean;
  readonly: boolean;
  private onChange?: (value: boolean) => void;

  constructor(opts: { label?: string; initial?: boolean; readonly?: boolean; change?: (v: boolean) => void }) {
    super();
    this.label = opts.label;
    this.value = Boolean(opts.initial);
    this.readonly = Boolean(opts.readonly);
    this.onChange = opts.change;
  }

  setValue(value: boolean): void {
    if (this.readonly) return;
    this.value = Boolean(value);
    this.onChange?.(this.value);
  }
}

export class ClientPickerControl extends ClassicPreset.Control {
  controlType = 'client-picker' as const;
  label?: string;
  value: string;
  readonly: boolean;
  private onChange?: (value: string) => void;

  constructor(opts: { label?: string; initial?: string; readonly?: boolean; change?: (value: string) => void }) {
    super();
    this.label = opts.label;
    this.value = opts.initial ?? '';
    this.readonly = Boolean(opts.readonly);
    this.onChange = opts.change;
  }

  setValue(value: string): void {
    if (this.readonly) return;
    this.value = value;
    this.onChange?.(value);
  }
}

export class ClientSensorValueControl extends ClassicPreset.Control {
  controlType = 'client-sensor-value' as const;
  nodeId: string;
  portId: string;

  constructor(opts: { nodeId: string; portId: string }) {
    super();
    this.nodeId = opts.nodeId;
    this.portId = opts.portId;
  }
}
