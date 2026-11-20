// AQ64L pages of Control Tribe 1.12.4, one tab each.
import { For, createSignal, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Aq64lCustom from './Aq64lCustom';
import Aq64lProgram from './Aq64lProgram';
import Aq64lLight from './Aq64lLight';

type Page = (p: { outputId: () => string | undefined }) => JSX.Element;
const PAGES: [string, Page][] = [
  ['Custom Mode', Aq64lCustom],
  ['Program', Aq64lProgram],
  ['Light FX', Aq64lLight],
];

export default function Aq64lPanel(props: {
  outputId: () => string | undefined;
}) {
  const [page, setPage] = createSignal(0);
  return (
    <div class="stack">
      <div class="flex wrap">
        <For each={PAGES}>
          {([name], i) => (
            <button
              class={page() === i() ? 'btn tiny' : 'btn tiny ghost'}
              onClick={() => setPage(i())}
            >
              {name}
            </button>
          )}
        </For>
      </div>
      <Dynamic component={PAGES[page()][1]} outputId={props.outputId} />
    </div>
  );
}
