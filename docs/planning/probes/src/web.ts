import { Schema } from 'effect';
import { Runtime } from 'foldkit';

const Model = Schema.Struct({ count: Schema.Number });
type Message = { readonly _tag: 'Increment' };
const app = Runtime.makeElement<Schema.Schema.Type<typeof Model>, Message>({
  Model,
  container: document.getElementById('app'),
  init: () => ({ model: { count: 0 } }),
  update: (model, _message) => ({ model: { count: model.count + 1 } }),
  view: (model, h) => h.div([], [
    h.h1([], ['Foldkit feasibility']),
    h.button([h.OnClick({ _tag: 'Increment' })], [`Count ${model.count}`]),
  ]),
});
Runtime.run(app);
