package com.mosheg.sudokufight.applocale

import android.app.LocaleManager
import android.os.Build
import android.os.LocaleList
import androidx.annotation.RequiresApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android's per-app language (localization plan 0א and 0יא, D103): the language chosen for this app in the
 * system settings ("App languages", Android 13+), read and written through LocaleManager. On Android 13 and
 * up it is the single source of truth for the app's language: the in-app picker writes it, "device language"
 * clears it, and the app reads it at launch and on every return to the foreground (src/i18n).
 *
 * Below Android 13 there is no per-app language: every function answers null or false and changes nothing.
 * Each LocaleManager call sits in a @RequiresApi helper that runs only inside an SDK_INT check, so Android
 * Lint (NewApi) sees the guard. The list of languages the system offers comes from res/xml/locales_config.xml
 * (plugins/withAppLocales.js).
 *
 * The JS side is src/services/appLocale.ts (module name "AppLocale"), which never throws.
 */
class AppLocaleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppLocale")

    /** Whether this Android has per-app languages (13, API 33, and up). */
    Function("isSupported") {
      return@Function Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    }

    /**
     * The app's languages as BCP-47 tags (Locale.toLanguageTag: "he", "id", not the old "iw", "in"), first
     * the preferred one; empty when the app follows the system. Null below Android 13.
     */
    Function("getApplicationLocales") {
      return@Function if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) readLocales() else null
    }

    /**
     * Sets the app's languages ([] = follow the system). Android applies it as a configuration change: the
     * activity declares locale|layoutDirection in configChanges (expo-localization's
     * allowDynamicLocaleChangesAndroid), so it is not recreated, and the app decides when to restart (D104).
     * False below Android 13, where nothing changes.
     */
    Function("setApplicationLocales") { tags: List<String> ->
      return@Function if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) writeLocales(tags) else false
    }
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun readLocales(): List<String>? {
    val manager = localeManager() ?: return null
    val tags = manager.getApplicationLocales().toLanguageTags()
    return if (tags.isEmpty()) emptyList() else tags.split(",")
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun writeLocales(tags: List<String>): Boolean {
    val manager = localeManager() ?: return false
    val wanted = tags.map { it.trim() }.filter { it.isNotEmpty() }
    manager.setApplicationLocales(
      if (wanted.isEmpty()) LocaleList.getEmptyLocaleList()
      else LocaleList.forLanguageTags(wanted.joinToString(","))
    )
    return true
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun localeManager(): LocaleManager? =
    appContext.reactContext?.applicationContext?.getSystemService(LocaleManager::class.java)
}
