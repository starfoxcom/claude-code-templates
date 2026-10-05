import type { EngineInterface } from 'claude-code'

import type { Card } from './texts'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

// The cards: the same bordered look as shared-pc's, each pinned to the right edge of the band.
export function drawCards(ui: Ui, cards: Card[], width: number) {
  const { Box, Button, Text } = ui
  return cards.map(card => (
    <Box
      key={card.key}
      alignSelf="flex-end"
      width={width}
      flexDirection="column"
      borderStyle="double"
      borderColor={card.tone}
      backgroundColor="black"
      paddingX={1}
    >
      <Text bold color="black" backgroundColor={card.tone}>
        {' USAGE GUARD '}
      </Text>
      <Text bold color={card.tone} wrap="wrap">
        {card.text}
      </Text>
      <Box>
        {card.buttons.map(({ key, label, isPrimary, onPress }) =>
          isPrimary ? (
            <Button key={key} label={label} variant="primary" onPress={onPress} />
          ) : (
            <Button key={key} label={label} onPress={onPress} />
          ),
        )}
      </Box>
    </Box>
  ))
}

// The slim line under the other mods' rows while an arm stands, with no border: when the session wakes,
// and a Disarm that takes the card's Cancel path.
export function drawArmLine(ui: Ui, text: string, onDisarm: () => unknown) {
  const { Box, Button, Text } = ui
  return (
    <Box key="usage-arm-line">
      <Text color="blue" wrap="truncate-end">
        {text}{' '}
      </Text>
      <Button key="usage-arm-disarm" label="Disarm" onPress={onDisarm} />
    </Box>
  )
}
