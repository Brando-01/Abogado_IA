// Original vector character. Run with Node, then compile scene.rml with Rive CLI.
import fs from 'node:fs';
import path from 'node:path';
const dir = import.meta.dirname;
let serial = 100;
const ids = {};
const id = name => ids[name] ||= `0:${serial++}`;
const node = (name, attrs, children) => `<Node id="${id(name)}" name="${name}" ${attrs}>${children}</Node>`;
const paint = color => `<Fill><SolidColor colorValue="${color}"/></Fill>`;
const shape = (name, x, y, geometry, color, extra = '') => `<Shape name="${name}" id="${id(name)}" x="${x}" y="${y}" ${extra}>${geometry}${paint(color)}</Shape>`;
const rect = (name, x, y, w, h, radius, color, extra = '') => shape(name, x, y, `<Rectangle width="${w}" height="${h}" cornerRadiusTL="${radius}"/>`, color, extra);
const ellipse = (name, x, y, w, h, color, extra = '') => shape(name, x, y, `<Ellipse width="${w}" height="${h}"/>`, color, extra);
const star = (name, x, y, size) => shape(name, x, y, `<Star width="${size}" height="${size}" points="4" innerRadius=".28" cornerRadius="1"/>`, 'FFD8AE63');
const mouthBind = '<DataBindContext sourcePathIds="0:40-0:42" propertyKey="17"/>';
const face = node('Head', 'x="0" y="-72"', [
  rect('ForeheadShine', -35, -58, 55, 7, 4, 'FFFFFFFF', 'rotation="-.08"'),
  node('Eyes', 'x="0" y="-3"', [
    ellipse('EyeShineL', -32, -10, 6, 6, 'FFFFFFFF'), ellipse('EyeShineR', 38, -10, 6, 6, 'FFFFFFFF'),
    rect('EyeL', -35, 0, 17, 27, 8, 'FFF0F8D8'), rect('EyeR', 35, 0, 17, 27, 8, 'FFF0F8D8')
  ].join('')),
  rect('BrowL', -35, -27, 25, 5, 3, 'FF9ED3BB', 'rotation="-.07"'), rect('BrowR', 35, -27, 25, 5, 3, 'FF9ED3BB', 'rotation=".07"'),
  `<Node name="Mouth" id="${id('Mouth')}" x="0" y="31" scaleY=".15">${mouthBind}${ellipse('MouthInside', 0, 0, 29, 18, 'FFF1F8DE')}</Node>`,
  ellipse('CheekL', -57, 24, 15, 7, 'FF4F9A80'), ellipse('CheekR', 57, 24, 15, 7, 'FF4F9A80'),
  rect('FaceScreen', 0, 3, 146, 103, 30, 'FF163E37'),
  rect('ShellHighlight', -3, -4, 177, 135, 41, 'FFF8F9E9'),
  rect('ShellRim', 0, 0, 184, 142, 43, 'FFBEDACA'),
  ellipse('EarL', -96, 7, 22, 43, 'FF366B59'), ellipse('EarR', 96, 7, 22, 43, 'FF366B59'),
  ellipse('AntennaTip', 0, -93, 15, 15, 'FFE4BD71'), rect('AntennaStem', 0, -79, 5, 21, 3, 'FF597C62')
].join(''));
const arm = (name, x) => node(name, `x="${x}" y="17" rotation="${x < 0 ? '-.2' : '.2'}"`, [
  rect(name + 'Fingers', 0, 67, 19, 4, 2, 'FFBDD2BE'),
  rect(name + 'Hand', 0, 60, 28, 27, 11, 'FFF3F4DF'),
  rect(name + 'Cuff', 0, 44, 27, 12, 5, 'FF6A9C7D'),
  rect(name + 'Sleeve', 0, 24, 25, 45, 12, 'FF3C7861')
].join(''));
const body = node('Body', 'x="200" y="211"', [
  arm('ArmR', 72),
  face,
  rect('TieKnot', 0, 10, 13, 13, 4, 'FFE9C580', 'rotation=".7854"'),
  rect('Tie', 0, 33, 11, 29, 4, 'FFE0B86C'),
  rect('Collar', 0, 12, 51, 22, 9, 'FFE4EDCC'),
  rect('BadgeLine1', -30, 49, 17, 3, 2, 'FFD8C088'), rect('BadgeLine2', -30, 55, 12, 3, 2, 'FFD8C088'),
  rect('Badge', -30, 51, 27, 22, 6, 'FF204D40'),
  rect('Coat', 0, 48, 128, 102, 33, 'FF346D57'),
  rect('Neck', 0, -2, 36, 27, 12, 'FFABC6A8'),
  arm('ArmL', -72),
  ellipse('FootL', -32, 109, 50, 20, 'FF214E41'), ellipse('FootR', 32, 109, 50, 20, 'FF214E41')
].join(''));
const sparkles = node('Sparkles', 'opacity="0"', star('Spark1', 84, 87, 24) + star('Spark2', 311, 104, 18) + star('Spark3', 298, 257, 12));
const scene = sparkles + body + ellipse('Shadow', 200, 348, 138, 16, '1E396B52') + ellipse('Halo', 200, 199, 286, 286, 'FFE8F0E3');
const keys = { x: 13, y: 14, rotation: 15, scaleX: 16, scaleY: 17, opacity: 18 };
const key = (name, property, values, frames = [0, 60, 120]) => `<KeyedObject objectId="${id(name)}"><KeyedProperty propertyKey="${keys[property]}">${values.map((value, i) => `<KeyFrameDouble frame="${frames[i]}" value="${value}" interpolationType="cubic"><CubicEaseInterpolator x1=".42" y1="0" x2=".58" y2="1"/></KeyFrameDouble>`).join('')}</KeyedProperty></KeyedObject>`;
const pose = (state, config) => {
  const p = { head: 0, headY: -72, bodyY: 211, left: -.2, right: .2, leftX: -72, rightX: 72, browL: -.07, browR: .07, eyesX: 0, sparkle: 0, ...config };
  const timeline = key('Body', 'y', [p.bodyY, p.bodyY - 5, p.bodyY]) + key('Head', 'rotation', [p.head, p.head + .045, p.head]) + key('Head', 'y', [p.headY, p.headY - 1.5, p.headY]) +
    key('ArmL', 'rotation', [p.left, p.left + (state === 'Celebrate' ? .3 : .1), p.left]) + key('ArmR', 'rotation', [p.right, p.right - (state === 'Speak' ? .28 : .1), p.right]) +
    key('ArmL', 'x', [p.leftX, p.leftX, p.leftX]) + key('ArmR', 'x', [p.rightX, p.rightX, p.rightX]) +
    key('BrowL', 'rotation', [p.browL, p.browL, p.browL]) + key('BrowR', 'rotation', [p.browR, p.browR, p.browR]) +
    key('Eyes', 'x', [p.eyesX, p.eyesX, p.eyesX]) + key('Sparkles', 'opacity', [p.sparkle, p.sparkle, p.sparkle]);
  return `<LinearAnimation id="${id(state)}" name="${state}" fps="60" duration="120" loopValue="loop">${timeline}</LinearAnimation>`;
};
const timelines = [pose('Idle', {}), pose('Listen', { head: -.13, left: 2.25, browL: -.2, browR: .17 }), pose('Think', { head: .13, right: -2.95, rightX: 27, browL: -.28, eyesX: 7 }), pose('Speak', { head: -.04, right: -1.1, browL: -.12, browR: .12 }), pose('Celebrate', { left: 2.4, right: -2.4, bodyY: 199, sparkle: 1 }), pose('Muted', { head: -.09, headY: -68, bodyY: 215, browL: .2, browR: -.2 }), pose('Error', { head: .17, browL: .28, browR: -.28 })].join('');
const blink = `<LinearAnimation id="${id('Blink')}" name="Blink" fps="60" duration="240" loopValue="loop">${key('Eyes', 'scaleY', [1, 1, .06, 1, 1], [0, 190, 197, 204, 240])}</LinearAnimation>`;
const condition = value => `<TransitionViewModelCondition><TransitionPropertyViewModelComparator><BindablePropertyNumber><DataBindContext sourcePathIds="0:40-0:41" propertyKey="636"/></BindablePropertyNumber></TransitionPropertyViewModelComparator><TransitionValueNumberComparator value="${value}"/></TransitionViewModelCondition>`;
const modes = ['Idle', 'Listen', 'Think', 'Speak', 'Celebrate', 'Muted', 'Error'];
const states = modes.map((name, value) => ({ name, value, stateId: id('State' + name) }));
const machine = `<StateMachine name="Assistant" id="0:7"><StateMachineLayer name="Behaviour"><AnyState x="0" y="-180">${states.map(s => `<StateTransition stateToId="${s.stateId}" duration="180">${condition(s.value)}</StateTransition>`).join('')}</AnyState><ExitState x="900" y="-180"/><EntryState x="-180" y="0"><StateTransition stateToId="${states[0].stateId}"/></EntryState>${states.map(s => `<AnimationState id="${s.stateId}" animationId="${id(s.name)}" x="${s.value % 4 * 210}" y="${Math.floor(s.value / 4) * 150}"/>`).join('')}</StateMachineLayer><StateMachineLayer name="Blink"><AnyState x="0" y="-100"/><ExitState x="400" y="-100"/><EntryState x="0" y="0"><StateTransition stateToId="${id('BlinkState')}"/></EntryState><AnimationState id="${id('BlinkState')}" animationId="${id('Blink')}" x="200" y="0"/></StateMachineLayer></StateMachine>`;
const model = `<ViewModel id="0:40" name="VoiceAssistant" defaultInstanceId="0:43"><ViewModelPropertyNumber id="0:41" name="mode"/><ViewModelPropertyNumber id="0:42" name="mouth"/><ViewModelInstance id="0:43" name="Default" exports="true"><ViewModelInstanceNumber viewModelPropertyId="0:41" propertyValue="0"/><ViewModelInstanceNumber viewModelPropertyId="0:42" propertyValue=".15"/></ViewModelInstance></ViewModel>`;
fs.writeFileSync(path.join(dir, 'scene.rml'), `<Rive version="1" kind="fragment"><Artboard id="0:2" name="AbogadoAssistant" width="400" height="380" styleId="0:3" defaultStateMachineId="0:7" viewModelId="0:40" viewModelInstanceId="0:43"><LayoutComponentStyle name="Artboard Style" id="0:3"/>${scene}${machine}${timelines}${blink}</Artboard>${model}</Rive>`.replace(/></g, '>\n<') + '\n');
console.log('scene.rml generated');
