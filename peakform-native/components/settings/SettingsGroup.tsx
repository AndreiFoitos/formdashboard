import { Children, Fragment, isValidElement, type ReactNode } from 'react'
import { Text, View } from 'react-native'

// iOS inset grouped list (DESIGN.md §6): a rounded surface group on bg, an
// optional sentence-case header above and footer below, hairlines between rows.

export function SettingsGroup({
  header,
  footer,
  children,
  first,
  raised,
}: {
  header?: string
  footer?: ReactNode
  children: ReactNode
  /** Drops the top margin on the first group of a screen. */
  first?: boolean
  /** On a surface sheet: surface-raised group with border hairlines (§2). */
  raised?: boolean
}) {
  const rows = Children.toArray(children).filter(isValidElement)
  if (rows.length === 0) return null
  return (
    <View className={first ? '' : 'mt-6'}>
      {header && <Text className="text-text-subtle text-footnote px-4 mb-2">{header}</Text>}
      <View className={`${raised ? 'bg-surface-raised' : 'bg-surface'} rounded-xl overflow-hidden`} style={{ borderCurve: 'continuous' }}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 && <View className={`h-px ml-4 ${raised ? 'bg-border' : 'bg-divider'}`} />}
            {row}
          </Fragment>
        ))}
      </View>
      {footer != null &&
        (typeof footer === 'string' ? (
          <Text className="text-text-subtle text-footnote px-4 mt-2">{footer}</Text>
        ) : (
          <View className="px-4 mt-2">{footer}</View>
        ))}
    </View>
  )
}
