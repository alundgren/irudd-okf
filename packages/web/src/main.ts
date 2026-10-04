import { Schema, Stream } from "effect";
import { Runtime, Subscription } from "foldkit";
import {
  dirty,
  initialModel,
  issue,
  ModelSchema,
  update,
  type Message,
  type Model,
} from "./model.ts";
import { view } from "./view.ts";
import "./style.css";

const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  navigation: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Subscription.fromEvent({
          target: window,
          type: "popstate",
          mapEvent: (): Message => ({ _tag: "Route", url: location.href }),
        }),
    },
  ),
  draftWarning: entry(
    { dirty: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ dirty: dirty(model) }),
      dependenciesToStream: ({ dirty: hasDraft }) =>
        hasDraft
          ? Subscription.fromEvent({
              target: window,
              type: "beforeunload",
              mapEvent: (event): Message => {
                event.preventDefault();
                event.returnValue = "";
                return { _tag: "Noop" };
              },
            })
          : Stream.empty,
    },
  ),
}));
const app = Runtime.makeElement<Model, Message>({
  Model: ModelSchema,
  container: document.getElementById("app"),
  init: () => issue(initialModel(), "context", "context"),
  update,
  view,
  subscriptions,
  devTools: false,
});
Runtime.run(app);
