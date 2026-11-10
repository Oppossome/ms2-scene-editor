import { z } from 'zod';
import { Group, type Object3D } from 'three';
import { ONE, ZERO, newId } from './constants.js';
import { ENTITY_LABELS, type EntityInput, type EntityType } from './types.js';
import { EntityProperty, Vector3Property, type PropContext, type PropertyControl, type RegisteredProperty } from './property.svelte.js';
import type { RenderContext } from './render-context.js';
import { issueText, omitUndefined } from './validation.js';

const text = z.string();
const optionalText = text.min(1).optional();

/**
 * An entity owns its properties (state, validation, editor rows and JSON), and its render resources. `render()`
 * brings existing resources in line with the properties and is cheap to repeat; `tick()` advances animation only.
 */
export abstract class BaseEntity {
  readonly id: string;
  abstract readonly type: EntityType;
  private readonly registered = new Map<string, RegisteredProperty>();
  /** Bumped when a property changes, so the scene knows what to render again. */
  revision = $state(0);
  renderedRevision = -1;
  disposed = false;
  protected gen = 0;
  protected context: RenderContext | null = null;
  /** The three.js group the transform applies to; absent for entities without geometry. */
  object: Group | null = null;

  readonly nameProperty = this.define('name', new EntityProperty(text.trim().min(1), 'Entity', (value) => ({
    key: 'name', label: 'Name', section: 'Data', type: 'string', value, edit: (name) => ({ name: name.trim() })
  })));
  readonly parentProperty = this.define('parentId', new EntityProperty(text.min(1).nullable(), null));
  readonly boneProperty = this.define('attachBone', new EntityProperty(optionalText, undefined, (value, ctx) =>
    ctx.parent?.type === 'character' && !(ctx.node.type === 'item' && ctx.skinned) ? {
      key: 'attachBone', label: 'Attach to', section: 'Attachment', type: 'enum', value: value ?? '',
      options: [
        { value: '', label: ctx.node.type === 'item' ? `(default: ${ctx.defaultBone || 'none'})` : '(character root)' },
        ...ctx.bones.map((bone) => ({ value: bone, label: bone.replace(/_/g, ' ') }))
      ],
      edit: (bone) => ({ attachBone: bone || undefined })
    } : null));
  readonly positionProperty = this.define('position', new Vector3Property('position', [...ZERO]));
  readonly rotationProperty = this.define('rotation', new Vector3Property('rotation', [...ZERO]));
  readonly scaleProperty = this.define('scale', new Vector3Property('scale', [...ONE]));
  readonly visibleProperty = this.define('visible', new EntityProperty(z.boolean(), true, (value) => ({
    key: 'visible', label: 'Visible', section: 'Appearance', type: 'bool', value, edit: (visible) => ({ visible })
  })));
  readonly lockedProperty = this.define('locked', new EntityProperty(z.boolean(), false, (value) => ({
    key: 'locked', label: 'Locked', section: 'Behaviour', type: 'bool', value, edit: (locked) => ({ locked })
  })));

  constructor(input: EntityInput = {}) {
    this.id = typeof input.id === 'string' && input.id ? input.id : newId();
  }

  get name() { return this.nameProperty.value; }
  get parentId() { return this.parentProperty.value; }
  get attachBone() { return this.boneProperty.value; }
  get position() { return this.positionProperty.value; }
  get rotation() { return this.rotationProperty.value; }
  get scale() { return this.scaleProperty.value; }
  get visible() { return this.visibleProperty.value; }
  get locked() { return this.lockedProperty.value; }

  protected define<T>(key: string, property: EntityProperty<T>): EntityProperty<T> {
    this.registered.set(key, property);
    return property;
  }

  // ----- state --------------------------------------------------------------------------------------------

  /** Validate edits without applying them; only values that differ are returned. */
  prepare(values: EntityInput): Map<RegisteredProperty, unknown> {
    const prepared = new Map<RegisteredProperty, unknown>();
    for (const [key, value] of Object.entries(values)) {
      const property = this.registered.get(key);
      if (!property) throw new Error(`${this.type} has no editable property ${key}`);
      let parsed: unknown;
      try {
        parsed = property.parse(value);
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        throw new Error(`${key}: ${issueText(error)}`);
      }
      if (JSON.stringify(parsed) !== JSON.stringify(property.value)) prepared.set(property, parsed);
    }
    return prepared;
  }

  apply(prepared: Map<RegisteredProperty, unknown>) {
    for (const [property, value] of prepared) property.assign(value);
    if (prepared.size) this.revision++;
  }

  /** Validate and apply edits at once (for entities that are not in a scene yet, or inside a transaction). */
  set(values: EntityInput) {
    this.apply(this.prepare(values));
  }

  /** Hierarchy moves are scene operations; the scene is the only caller. */
  link(parentId: string | null, attachBone?: string) {
    this.set({ parentId, attachBone });
  }

  // ----- JSON ---------------------------------------------------------------------------------------------

  /** Applying saved values never touches assets: restoring is cheap and rendering happens afterwards. */
  restore(input: EntityInput, issues: string[] = []): this {
    const values = new Map<RegisteredProperty, unknown>();
    for (const [key, property] of this.registered) {
      if (input[key] === undefined) {
        if (property.required) throw new Error(`${key}: required`);
        continue;
      }
      try {
        values.set(property, property.parse(input[key]));
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        if (property.required) throw new Error(`${key}: ${issueText(error)}`);
        issues.push(`${this.id}.${key}: ${issueText(error)}; default used`);
      }
    }
    if (!values.has(this.nameProperty)) values.set(this.nameProperty, this.type);
    this.apply(values);
    return this;
  }

  toJSON(): { type: EntityType; id: string } & EntityInput {
    return omitUndefined({
      type: this.type,
      id: this.id,
      ...Object.fromEntries([...this.registered].map(([key, property]) => [key, property.value]))
    });
  }

  controls(ctx: PropContext): PropertyControl[] {
    const info = (key: string, label: string, value: string): PropertyControl => ({ key, label, value, type: 'readonly', section: 'Data' });
    return [
      ...[...this.registered.values()].flatMap((property) => property.control(ctx) ?? []),
      info('class', 'Class', ENTITY_LABELS[this.type]),
      info('parent', 'Parent', ctx.parent?.name ?? '(scene)'),
      info('id', 'Id', this.id)
    ];
  }

  // ----- rendering ----------------------------------------------------------------------------------------

  protected createObject(): Group {
    return new Group();
  }

  /** Put the transform and visibility on the entity's group, creating it on first use. */
  protected renderTransform(context: RenderContext) {
    this.context = context;
    this.disposed = false;
    if (!this.object) {
      this.object = this.createObject();
      context.tag(this.object, this.id);
    }
    this.object.position.set(...this.position);
    this.object.rotation.set(...this.rotation, 'XYZ');
    this.object.scale.set(...this.scale);
    this.object.visible = this.visible;
    this.renderedRevision = this.revision;
  }

  render(context: RenderContext) {
    this.renderTransform(context);
  }

  tick(_delta: number) {}

  /** What the transform gizmo drives. */
  get gizmoTarget(): Object3D | undefined {
    return this.object ?? undefined;
  }

  /** What bounds, the selection outline and group centering measure. */
  boundsTargets(): Object3D[] {
    return this.object ? [this.object] : [];
  }

  dispose() {
    this.disposed = true;
    this.gen++;
    this.object?.removeFromParent();
    this.context?.changed();
  }
}
