/**
 * Put the methods of one or more method classes on a class's prototype, so a large class can be
 * written as several modules (packages/map/app/app.js and packages/map/src/app/*.js).
 *
 * Each source is a class whose prototype methods are written exactly as they would be inside the
 * target class; they are copied with their property descriptors, so they stay non-enumerable,
 * writable and configurable, like methods declared in the class body, and `this` is the target's
 * instance when they are called. A name defined twice (in the target or in two sources) throws:
 * a silent override is how a split changes behaviour.
 * @template {{ prototype: object, name: string }} T
 * @param {T} target
 * @param {Iterable<{ prototype: object, name: string }>} sources
 * @returns {T}
 */
export function installMethods(target, sources) {
  for (const source of sources) {
    const descriptors = Object.getOwnPropertyDescriptors(source.prototype);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (name === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(target.prototype, name)) {
        throw new Error(`${target.name}.${name} is defined twice (again in ${source.name})`);
      }
      Object.defineProperty(target.prototype, name, descriptor);
    }
  }
  return target;
}
