// Native header and sheet options (DESIGN.md §5). Pushed screens get a standard
// title (not large), modals get Cancel/Done, short choices are form sheets on surface.

import type { NativeStackNavigationOptions } from '@react-navigation/native-stack'
import { colors } from './tokens'

export const pushedHeader: NativeStackNavigationOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal',
}

export const modalHeader: NativeStackNavigationOptions = {
  ...pushedHeader,
  presentation: 'modal',
  headerStyle: { backgroundColor: colors.surface },
  contentStyle: { backgroundColor: colors.surface },
}

export const formSheet: NativeStackNavigationOptions = {
  headerShown: false,
  presentation: 'formSheet',
  sheetGrabberVisible: true,
  sheetAllowedDetents: 'fitToContents',
  contentStyle: { backgroundColor: colors.surface },
}
