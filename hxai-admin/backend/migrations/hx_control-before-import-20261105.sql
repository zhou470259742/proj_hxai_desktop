-- MySQL dump 10.13  Distrib 8.4.13, for macos27.0 (arm64)
--
-- Host: 127.0.0.1    Database: hx_control
-- ------------------------------------------------------
-- Server version	8.4.13

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `audit_chain_head`
--

DROP TABLE IF EXISTS `audit_chain_head`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_chain_head` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_chain_head`
--

LOCK TABLES `audit_chain_head` WRITE;
/*!40000 ALTER TABLE `audit_chain_head` DISABLE KEYS */;
INSERT INTO `audit_chain_head` VALUES (1,'72bc134a6b14f22ff4b1b9a077ee1459be752c678bf7efae1d1b1f65557f11de');
/*!40000 ALTER TABLE `audit_chain_head` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_name` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_json` longtext COLLATE utf8mb4_unicode_ci,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `prev_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,'usr_0911a56f326b','系统管理员','登录','session','usr_0911a56f326b','管理控制台','{\"username\":\"admin\"}','127.0.0.1','2026-11-05 05:59:01.735','','72bc134a6b14f22ff4b1b9a077ee1459be752c678bf7efae1d1b1f65557f11de');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `client_tokens`
--

DROP TABLE IF EXISTS `client_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_tokens` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `created_by` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `revoked` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_tokens_hash` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `client_tokens`
--

LOCK TABLES `client_tokens` WRITE;
/*!40000 ALTER TABLE `client_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `client_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `experts`
--

DROP TABLE IF EXISTS `experts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `experts` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_title` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emoji` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `role_prompt` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_provider` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model_name` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permission_mode` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'confirm_write',
  `plugin_ids_json` longtext COLLATE utf8mb4_unicode_ci,
  `skill_ids_json` longtext COLLATE utf8mb4_unicode_ci,
  `visibility` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `owner` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_experts_key` (`key`),
  KEY `idx_experts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `experts`
--

LOCK TABLES `experts` WRITE;
/*!40000 ALTER TABLE `experts` DISABLE KEYS */;
/*!40000 ALTER TABLE `experts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `grants`
--

DROP TABLE IF EXISTS `grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `grants` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expert_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_id` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_grants_expert` (`expert_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `grants`
--

LOCK TABLES `grants` WRITE;
/*!40000 ALTER TABLE `grants` DISABLE KEYS */;
/*!40000 ALTER TABLE `grants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `handoffs`
--

DROP TABLE IF EXISTS `handoffs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `handoffs` (
  `grant` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`grant`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `handoffs`
--

LOCK TABLES `handoffs` WRITE;
/*!40000 ALTER TABLE `handoffs` DISABLE KEYS */;
/*!40000 ALTER TABLE `handoffs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `llm_providers`
--

DROP TABLE IF EXISTS `llm_providers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `llm_providers` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'openai-compatible',
  `base_url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `api_key` text COLLATE utf8mb4_unicode_ci,
  `provider_id` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'enabled',
  `note` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_llm_providers_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `llm_providers`
--

LOCK TABLES `llm_providers` WRITE;
/*!40000 ALTER TABLE `llm_providers` DISABLE KEYS */;
/*!40000 ALTER TABLE `llm_providers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `model_aliases`
--

DROP TABLE IF EXISTS `model_aliases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `model_aliases` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `badge` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `icon` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_model` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fallback_model` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `capabilities_json` longtext COLLATE utf8mb4_unicode_ci,
  `context_tokens` bigint DEFAULT '32000',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'enabled',
  `sort_order` bigint NOT NULL DEFAULT '100',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_model_aliases_key` (`key`),
  KEY `idx_aliases_provider` (`provider_ref`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `model_aliases`
--

LOCK TABLES `model_aliases` WRITE;
/*!40000 ALTER TABLE `model_aliases` DISABLE KEYS */;
/*!40000 ALTER TABLE `model_aliases` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `plugins`
--

DROP TABLE IF EXISTS `plugins`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plugins` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `category` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transport` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'streamable_http',
  `endpoint` text COLLATE utf8mb4_unicode_ci,
  `command` text COLLATE utf8mb4_unicode_ci,
  `args_json` longtext COLLATE utf8mb4_unicode_ci,
  `auth_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'oauth',
  `auth_config_json` longtext COLLATE utf8mb4_unicode_ci,
  `visibility` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all',
  `version` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'enabled',
  `owner` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `package_file` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `package_sha256` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `package_size` bigint DEFAULT NULL,
  `dependencies_json` longtext COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plugins_key` (`key`),
  KEY `idx_plugins_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plugins`
--

LOCK TABLES `plugins` WRITE;
/*!40000 ALTER TABLE `plugins` DISABLE KEYS */;
/*!40000 ALTER TABLE `plugins` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `jti` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked` tinyint NOT NULL DEFAULT '0',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`jti`),
  KEY `idx_sessions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sessions`
--

LOCK TABLES `sessions` WRITE;
/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
INSERT INTO `sessions` VALUES ('hE8XOsUUvtenhb4TVFEyIpvr','usr_0911a56f326b','2026-11-05 05:59:01.732','2026-11-05 17:59:01.732',0,'127.0.0.1','curl/8.7.1');
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `settings`
--

LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES ('allow_self_install','false'),('brand_app_name','HX AI 工作台'),('manifest_channel','stable'),('min_client_version','0.1.0'),('org_name','HX'),('require_update','false');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `skills`
--

DROP TABLE IF EXISTS `skills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `skills` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(190) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `category` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '1.0.0',
  `trigger_desc` text COLLATE utf8mb4_unicode_ci,
  `content` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `author` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `installs` bigint NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_skills_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `skills`
--

LOCK TABLES `skills` WRITE;
/*!40000 ALTER TABLE `skills` DISABLE KEYS */;
/*!40000 ALTER TABLE `skills` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_expert_state`
--

DROP TABLE IF EXISTS `user_expert_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_expert_state` (
  `user_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active_expert_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_expert_state`
--

LOCK TABLES `user_expert_state` WRITE;
/*!40000 ALTER TABLE `user_expert_state` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_expert_state` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `username` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'member',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `last_login_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES ('usr_0911a56f326b','admin','系统管理员','admin@hx.local','平台管理','admin','active','scrypt$16384$9cfc42c63c46f349088740b14df6c530$a4732b4ecd3e4beb4a099700aae9c1384ef49abda1492265987c4daa042cc72642c67d3a294ced7cef0a21a29390f38fac980abcdf3852a5329e8c89732efa7e','2026-11-05 05:58:58.395','2026-11-05 05:59:01.734');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-05 15:34:14
