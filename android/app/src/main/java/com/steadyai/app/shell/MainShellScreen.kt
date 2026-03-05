package com.steadyai.app.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.steadyai.app.agents.AgentInteractionScreen
import com.steadyai.app.checkin.CheckInScreen
import com.steadyai.app.community.CommunityScreen
import com.steadyai.app.health.HealthConnectRoute
import com.steadyai.app.store.StoreScreen
import com.steadyai.app.ui.HomeScreen

enum class MainTab(
    val route: String,
    val label: String
) {
    HOME("tab_home", "Home"),
    AGENTS("tab_agents", "Agents"),
    COMMUNITY("tab_community", "Community"),
    CHECK_IN("tab_check_in", "Check-in"),
    HEALTH("tab_health", "Health"),
    STORE("tab_store", "Store")
}

@Composable
fun MainShellScreen() {
    val navController = rememberNavController()
    val tabs = MainTab.entries
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = currentDestination.isTabSelected(tab.route),
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Text(tab.label.take(1)) },
                        label = { Text(tab.label) }
                    )
                }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = MainTab.HOME.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(MainTab.HOME.route) {
                HomeScreen()
            }
            composable(MainTab.AGENTS.route) {
                AgentInteractionScreen()
            }
            composable(MainTab.COMMUNITY.route) {
                CommunityScreen()
            }
            composable(MainTab.CHECK_IN.route) {
                CheckInScreen()
            }
            composable(MainTab.HEALTH.route) {
                HealthConnectRoute()
            }
            composable(MainTab.STORE.route) {
                StoreScreen()
            }
        }
    }
}

private fun NavDestination?.isTabSelected(route: String): Boolean {
    return this?.hierarchy?.any { it.route == route } == true
}
