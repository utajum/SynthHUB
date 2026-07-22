// GuitarTribe preset bar: apply a factory preset or import/export the
// GuitarTribe app's JSON format. Applying sets each value + sends its CC.
import { For, Show } from 'solid-js';
import type { DeviceDef, DeviceSetting } from '../lib/types';
import type { DeviceDriver } from '../devices/_shared/driver';
import { paramKey } from '../devices/_shared/paramKey';
import { actions, useApp } from '../lib/store-solid';

interface Props {
  slug: string;
  def: DeviceDef;
  driver: DeviceDriver;
  outputId: () => string | undefined;
}

interface Entry {
  key: string;
  setting: DeviceSetting;
  pkt: number;
  fnName: string;
}

export default function GuitarTribePresets(props: Props) {
  const params = useApp((s) => s.params[props.slug] ?? {});

  // every addressable control + its store key / CC number
  const entries = (): Entry[] => {
    const out: Entry[] = [];
    for (const fn of props.def.functions) {
      (fn.settings ?? []).forEach((setting, i) => {
        const pkt = setting.sysex?.pkt;
        if (pkt === undefined) return;
        out.push({
          key: `${paramKey(fn.name, setting, i)}:value`,
          setting,
          pkt,
          fnName: fn.name,
        });
      });
    }
    return out;
  };

  // store + send each value
  const apply = (values: Record<string, number>, label: string) => {
    const a = actions();
    const out = props.outputId();
    const byKey = new Map(entries().map((e) => [e.key, e]));
    let sent = 0;
    for (const [key, v] of Object.entries(values)) {
      a.setParam(props.slug, key, v);
      const e = byKey.get(key);
      if (e && props.driver.sendSetting(out, e.setting, { value: v }).ok)
        sent++;
    }
    a.pushLog({
      dir: sent ? 'out' : 'info',
      text: out
        ? `${label}: sent ${sent} control(s)`
        : `${label}: applied (no MIDI out)`,
    });
  };

  const importFile = async (file: File) => {
    let data: { commands?: { controlvalue?: number[]; value?: number }[] };
    try {
      data = JSON.parse(await file.text());
    } catch {
      actions().pushLog({ dir: 'info', text: `import ${file.name}: bad JSON` });
      return;
    }
    const byPkt = new Map(entries().map((e) => [e.pkt, e]));
    const values: Record<string, number> = {};
    for (const cmd of data.commands ?? []) {
      const pkt = cmd.controlvalue?.[0];
      const e = pkt !== undefined ? byPkt.get(pkt) : undefined;
      if (e && typeof cmd.value === 'number') values[e.key] = cmd.value;
    }
    if (!Object.keys(values).length) {
      actions().pushLog({
        dir: 'info',
        text: `import ${file.name}: no matching controls`,
      });
      return;
    }
    apply(values, `import ${file.name}`);
  };

  const exportFile = () => {
    const p = params();
    const v = props.driver.variant;
    const commands = entries().map((e) => ({
      name: e.setting.title,
      type: (e.setting.raw as { type?: string }).type ?? '',
      controlvalue: (e.setting.raw as { controlvalue?: number[] })
        .controlvalue ?? [e.pkt],
      value: p[e.key] ?? Number(e.setting.default) ?? 0,
    }));
    const profile = {
      devicename: props.def.name,
      firmware: '',
      software: 'synthhub-pwa',
      timestamp: String(Date.now()),
      protocol: v.protocol,
      deviceId: v.deviceId,
      modelid: v.modelId,
      commands,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(profile, null, 1)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${props.slug}-preset.json`;
    a.click();
    URL.revokeObjectURL(url);
    actions().pushLog({
      dir: 'info',
      text: `exported ${commands.length} control(s)`,
    });
  };

  return (
    <div
      class="flex wrap"
      style={{
        'justify-content': 'space-between',
        'align-items': 'center',
        gap: '0.5rem',
      }}
    >
      <span
        class="flex wrap"
        style={{ gap: '0.4rem', 'align-items': 'center' }}
      >
        <span class="tiny dim">presets</span>
        <Show
          when={props.def.presets?.length}
          fallback={<span class="tiny dim">(none - import one below)</span>}
        >
          <For each={props.def.presets}>
            {(preset) => (
              <button
                class="btn ghost tiny"
                disabled={!props.outputId()}
                title={`Apply ${preset.name} and send it to the pedal`}
                onClick={() => apply(preset.values, preset.name)}
              >
                {preset.name}
              </button>
            )}
          </For>
        </Show>
      </span>
      <span class="flex" style={{ gap: '0.4rem' }}>
        <label
          class="btn ghost tiny"
          style={{ cursor: 'pointer' }}
          title="Load a preset (GuitarTribe .json) and send it"
        >
          import
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) importFile(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <button
          class="btn ghost tiny"
          title="Save current values as a GuitarTribe .json preset"
          onClick={exportFile}
        >
          export
        </button>
      </span>
    </div>
  );
}
