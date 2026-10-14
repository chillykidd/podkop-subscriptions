include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-podkop-subscriptions
PKG_VERSION:=0.2.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-podkop-subscriptions
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI subscription manager for Podkop
  DEPENDS:=+podkop +luci-app-podkop +luci-base +rpcd +podkop-subscriptions
endef

define Build/Compile
endef

define Package/luci-app-podkop-subscriptions/install
  $(CP) ./files/* $(1)/
  chmod 0755 $(1)/etc/init.d/podkop-subscriptions
endef

define Package/luci-app-podkop-subscriptions/postinst
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
  mkdir -p /etc/podkop-subscriptions/integration
  ucode /usr/share/podkop-subscriptions/integrate.uc install || exit 1
  /etc/init.d/podkop-subscriptions enable
  for cache in /tmp/luci-indexcache*; do
    [ -f "$$cache" ] && rm -f "$$cache"
  done
  /etc/init.d/rpcd restart
fi
exit 0
endef

define Package/luci-app-podkop-subscriptions/prerm
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
  ucode /usr/share/podkop-subscriptions/integrate.uc remove || exit 1
  /etc/init.d/podkop-subscriptions disable
fi
exit 0
endef

define Package/luci-app-podkop-subscriptions/postrm
#!/bin/sh
if [ -z "$$IPKG_INSTROOT" ]; then
  for cache in /tmp/luci-indexcache*; do
    [ -f "$$cache" ] && rm -f "$$cache"
  done
  /etc/init.d/rpcd restart
fi
exit 0
endef

$(eval $(call BuildPackage,luci-app-podkop-subscriptions))
