export function groundAgentResultArtifacts(result) {
  if (!result?.circuitSpec || !result?.simulationPlan?.currentPaths?.length) {
    return result;
  }

  const ledPath = findLedSeriesPath(result.circuitSpec);
  if (!ledPath) {
    return result;
  }

  let repaired = false;
  const repairs = [];
  const currentPaths = result.simulationPlan.currentPaths.map((path) => {
    if (!isLedCurrentPath(path) || (path.from === ledPath.from && path.to === ledPath.to)) {
      return path;
    }

    repaired = true;
    repairs.push({ before: path, after: { ...path, from: ledPath.from, through: ledPath.through, to: ledPath.to } });
    return {
      ...path,
      from: ledPath.from,
      through: ledPath.through,
      to: ledPath.to
    };
  });

  if (!repaired) {
    return result;
  }

  return {
    ...result,
    agentEvents: rewriteAgentEvents(result.agentEvents, repairs),
    requirementMarkdown: rewriteCurrentFlowMarkdown(
      result.requirementMarkdown,
      result.simulationPlan.currentPaths,
      currentPaths
    ),
    simulationPlan: {
      ...result.simulationPlan,
      currentPaths
    }
  };
}

function isLedCurrentPath(path) {
  return /led/i.test(`${path?.id || ''} ${path?.label || ''} ${path?.primitiveId || ''}`);
}

function findLedSeriesPath(spec) {
  const components = spec.components || [];
  const connections = spec.connections || [];
  const controller = components.find((component) => component.partId === 'arduino-uno')
    || components.find((component) => /arduino/i.test(`${component.partId} ${component.label}`));
  const led = components.find((component) => /led/i.test(`${component.partId} ${component.label}`));
  const resistor = components.find((component) => /resistor/i.test(`${component.partId} ${component.label}`));

  if (!controller || !led) {
    return null;
  }

  const groundConnection = connections.find((connection) => (
    endpointMatches(connection.from, led.id, /^k|cathode$/i)
      && endpointMatches(connection.to, controller.id, /^gnd$/i)
  ) || (
    endpointMatches(connection.to, led.id, /^k|cathode$/i)
      && endpointMatches(connection.from, controller.id, /^gnd$/i)
  ));
  if (!groundConnection) {
    return null;
  }

  if (resistor) {
    const resistorToLed = connections.find((connection) => connectsComponents(connection, resistor.id, led.id));
    const controllerToResistor = connections.find((connection) => connectsComponents(connection, controller.id, resistor.id));
    const signalPin = controllerSignalPin(controllerToResistor, controller.id);
    if (resistorToLed && signalPin) {
      return {
        from: `${controller.id}:${signalPin}`,
        through: [resistor.id, led.id],
        to: `${controller.id}:GND`
      };
    }
  }

  const controllerToLed = connections.find((connection) => connectsComponents(connection, controller.id, led.id));
  const signalPin = controllerSignalPin(controllerToLed, controller.id);
  if (!signalPin) {
    return null;
  }

  return {
    from: `${controller.id}:${signalPin}`,
    through: [led.id],
    to: `${controller.id}:GND`
  };
}

function endpointMatches(endpoint, componentId, pinPattern) {
  return endpoint?.componentId === componentId && pinPattern.test(String(endpoint.pin || ''));
}

function connectsComponents(connection, firstId, secondId) {
  return (
    connection.from?.componentId === firstId && connection.to?.componentId === secondId
  ) || (
    connection.from?.componentId === secondId && connection.to?.componentId === firstId
  );
}

function controllerSignalPin(connection, controllerId) {
  if (!connection) {
    return null;
  }

  const endpoint = connection.from?.componentId === controllerId
    ? connection.from
    : connection.to?.componentId === controllerId
      ? connection.to
      : null;

  if (!endpoint || /^(gnd|ground|5v|3v3|vin)$/i.test(endpoint.pin)) {
    return null;
  }

  return endpoint.pin;
}

function rewriteCurrentFlowMarkdown(markdown, beforePaths, afterPaths) {
  if (!markdown) {
    return markdown;
  }

  return beforePaths.reduce((text, before, index) => {
    const after = afterPaths[index];
    if (!after || before.from === after.from || !before.from || !after.from) {
      return text;
    }

    const fromToPattern = new RegExp(
      `from ${escapeRegExp(before.from)} to ${escapeRegExp(before.to)}`,
      'g'
    );
    return text.replace(fromToPattern, `from ${after.from} to ${after.to}`);
  }, markdown);
}

function rewriteAgentEvents(events, repairs) {
  if (!events?.length || !repairs.length) {
    return events;
  }

  return events.map((event) => {
    if (/estimate[_-]?current[_-]?paths/i.test(event.name || '')) {
      return {
        ...event,
        summary: repairedCurrentPathSummary(repairs)
      };
    }

    return {
      ...event,
      summary: rewriteCurrentPathText(event.summary, repairs)
    };
  });
}

function repairedCurrentPathSummary(repairs) {
  const endpoints = repairs
    .map(({ after }) => `${after.label || after.id}: ${after.from} to ${after.to}`)
    .join('; ');
  return `Current path endpoints were grounded to the validated CircuitSpec: ${endpoints}.`;
}

function rewriteCurrentPathText(text, repairs) {
  if (!text) {
    return text;
  }

  return repairs.reduce((nextText, { before, after }) => {
    const beforePin = endpointPin(before.from);
    const afterPin = endpointPin(after.from);
    if (!beforePin || !afterPin || beforePin === afterPin) {
      return nextText;
    }
    return nextText.replace(new RegExp(`\\b${escapeRegExp(beforePin)}\\b`, 'g'), afterPin);
  }, text);
}

function endpointPin(endpoint) {
  return String(endpoint || '').split(':')[1] || null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
