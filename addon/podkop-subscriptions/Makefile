include $(TOPDIR)/rules.mk

PKG_NAME:=podkop-subscriptions
PKG_VERSION:=0.2.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/podkop-subscriptions
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Subscription manager for Podkop
  DEPENDS:=+podkop +rpcd +ucode +ucode-mod-fs +ucode-mod-digest +curl +ca-bundle +flock
endef

define Package/podkop-subscriptions/description
  Subscription backend for the Podkop add-on. Requires installed Podkop.
endef

define Package/podkop-subscriptions/conffiles
/etc/config/podkop_subscriptions
endef

define Build/Compile
endef

define Package/podkop-subscriptions/install
  $(CP) ./files/* $(1)/
  chmod 0600 $(1)/etc/config/podkop_subscriptions
  chmod 0755 $(1)/usr/libexec/rpcd/podkop-subscriptions
endef

define Package/podkop-subscriptions/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || /etc/init.d/rpcd restart
exit 0
endef

define Package/podkop-subscriptions/postrm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || /etc/init.d/rpcd restart
exit 0
endef

$(eval $(call BuildPackage,podkop-subscriptions))
