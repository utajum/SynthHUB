// One device setting rendered as interactive controls; changes go through
// the driver to hardware, values are cached in the store, SysEx is logged.
import { For, Show, createMemo, onCleanup } from 'solid-js';
import type { DeviceSetting } from '../lib/types';
import type { DeviceDriver } from '../devices/_shared/driver';
import { decompose, type SubControl } from '../devices/_shared/controls';
import { paramKey } from '../devices/_shared/paramKey';
import { Dropdown, Toggle, Spinbox, Radio, Slider } from './controls/Widgets';
import { actions, useApp } from '../lib/store-solid';

interface Props {
  slug: string;
  fnName: string;
  position: number;
  setting: DeviceSetting;
  driver: DeviceDriver;
  outputId: () => string | undefined;
}

export default function SettingControl(props: Props) {
  const subs = createMemo(() => decompose(props.setting));
  const baseKey = createMemo(() =>
    paramKey(props.fnName, props.setting, props.position),
  );

  // subscribe to this device's cached params
  const params = useApp((s) => s.params[props.slug] ?? {});

  const valueOf = (sub: SubControl): number => {
    const k = `${baseKey()}:${sub.id}`;
    const cached = params()[k];
    return cached ?? Number(sub.default) ?? 0;
  };

  // debounce transmit so dragging never floods the device; the UI updates
  // instantly and identical values are skipped
  const SEND_DEBOUNCE_MS = 120;
  let sendTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSentSig = '';
  onCleanup(() => sendTimer && clearTimeout(sendTimer));

  const transmit = (lastSub: SubControl, v: number) => {
    const a = actions();
    const all: Record<string, number> = {};
    for (const s of subs()) all[s.id] = valueOf(s);
    const sig = JSON.stringify(all);
    if (sig === lastSentSig) return; // dedupe: nothing actually changed
    lastSentSig = sig;
    // pass the changed sub id so per-sub encodings emit only that message
    const res = props.driver.sendSetting(
      props.outputId(),
      props.setting,
      all,
      lastSub.id,
    );
    a.pushLog({
      dir: res.ok ? 'out' : 'info',
      text: res.hex
        ? `${res.ok ? '' : '[no-port] '}${props.setting.title} ${lastSub.label} = ${v}  >  ${res.hex}`
        : `${props.setting.title}: not addressable (no SysEx pkt)`,
    });
  };

  const onInput = (sub: SubControl, v: number) => {
    // update the store immediately; debounce the hardware transmit
    actions().setParam(props.slug, `${baseKey()}:${sub.id}`, v);
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => transmit(sub, v), SEND_DEBOUNCE_MS);
  };

  const addressable = createMemo(() => props.setting.sysex?.pkt !== undefined);

  // action-type settings render as a single button that emits the request
  const isAction = createMemo(() => props.setting.kind === 'button');
  const fireAction = () => {
    const a = actions();
    const res = props.driver.send(props.outputId(), props.setting, 0);
    a.pushLog({
      dir: res.ok ? 'out' : 'info',
      text: res.hex
        ? `${props.setting.title} [${props.setting.type}] > ${res.hex}`
        : `${props.setting.title}: action (${props.setting.type})`,
    });
  };

  return (
    <div class="setting" style={{ 'margin-bottom': '0.6rem' }}>
      <div class="flex" style={{ 'justify-content': 'space-between' }}>
        <span class="tiny hot">{props.setting.title}</span>
        <span class="flex" style={{ gap: '0.4rem' }}>
          <Show when={props.setting.minFirmware}>
            <span class="pill tiny">fw&gt;={props.setting.minFirmware}</span>
          </Show>
          <Show when={props.setting.sysex?.pkt !== undefined}>
            <span class="pill tiny">
              pkt {props.setting.sysex!.pkt}
              <Show when={props.setting.sysex!.spkt !== undefined}>
                .{props.setting.sysex!.spkt}
              </Show>
            </span>
          </Show>
          <Show when={!addressable() && !isAction()}>
            <span
              class="pill tiny amber"
              title="This control uses the device's index-based master-data path; its individual opcode is not confirmed, so the value is edited and cached locally but not transmitted as an individual SysEx (avoids mis-addressing on hardware)."
            >
              index-addr
            </span>
          </Show>
        </span>
      </div>
      <Show when={isAction()}>
        <button
          class="btn"
          disabled={!props.outputId()}
          onClick={fireAction}
          style={{ 'margin-top': '0.3rem' }}
        >
          &gt; {props.setting.title}
        </button>
      </Show>
      <div
        class="grid"
        classList={{ hidden: isAction() }}
        style={{
          'grid-template-columns':
            subs().length > 1 ? 'repeat(auto-fit,minmax(150px,1fr))' : '1fr',
          gap: '0.5rem',
          'margin-top': '0.3rem',
        }}
      >
        <For each={subs()}>
          {(sub) => {
            const id = `${baseKey()}:${sub.id}`;
            const label = () =>
              sub.label !== props.setting.title ? sub.label : undefined;
            // props are written inline (not spread) so value stays reactive
            const handle = (v: number) => onInput(sub, v);
            const def = Number(sub.default) || 0;
            return (
              <>
                <Show when={sub.kind === 'dropdown'}>
                  <Dropdown
                    id={id}
                    label={label()}
                    value={valueOf(sub)}
                    onInput={handle}
                    options={sub.options ?? []}
                    default={def}
                  />
                </Show>
                <Show when={sub.kind === 'toggle'}>
                  <Toggle
                    id={id}
                    label={label()}
                    value={valueOf(sub)}
                    onInput={handle}
                    options={sub.options}
                    default={def}
                  />
                </Show>
                <Show when={sub.kind === 'radio'}>
                  <Radio
                    id={id}
                    label={label()}
                    value={valueOf(sub)}
                    onInput={handle}
                    options={sub.options ?? []}
                    default={def}
                  />
                </Show>
                <Show when={sub.kind === 'slider'}>
                  <Slider
                    id={id}
                    label={label()}
                    value={valueOf(sub)}
                    onInput={handle}
                    min={sub.min}
                    max={sub.max}
                    step={sub.step}
                    default={def}
                  />
                </Show>
                <Show when={sub.kind === 'spinbox'}>
                  <Spinbox
                    id={id}
                    label={label()}
                    value={valueOf(sub)}
                    onInput={handle}
                    min={sub.min}
                    max={sub.max}
                    default={def}
                  />
                </Show>
              </>
            );
          }}
        </For>
      </div>
    </div>
  );
}
