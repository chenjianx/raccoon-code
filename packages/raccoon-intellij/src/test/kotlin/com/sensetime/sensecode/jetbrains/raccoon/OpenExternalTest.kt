package com.sensetime.sensecode.jetbrains.raccoon

import com.intellij.ide.browsers.BrowserLauncher
import com.intellij.ide.browsers.BrowserLauncherImpl
import com.intellij.ide.browsers.WebBrowser
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase

class OpenExternalTest : LightJavaCodeInsightFixtureTestCase() {
    fun testOpensBrowserAuthorizationUrlThroughIdeBrowserLauncher() {
        val opened = mutableListOf<String>()
        ApplicationManager.getApplication().replaceService(
            BrowserLauncher::class.java,
            object : BrowserLauncherImpl() {
                override fun browse(url: String, browser: WebBrowser?, project: Project?) {
                    opened.add(url)
                }
            },
            testRootDisposable,
        )

        project.getService(RaccoonService::class.java).onSidecarMessage(
            """{"type":"openExternal","url":"https://example.com/login?redirect=http%3A%2F%2F127.0.0.1%3A12345%2Fauth%2Fcallback&state=test"}"""
        )
        PlatformTestUtil.dispatchAllEventsInIdeEventQueue()

        assertEquals(
            listOf("https://example.com/login?redirect=http%3A%2F%2F127.0.0.1%3A12345%2Fauth%2Fcallback&state=test"),
            opened,
        )
    }
}
